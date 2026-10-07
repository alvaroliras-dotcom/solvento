-- Solvento trabaja casi siempre fuera de la nave: fichar la entrada o la salida
-- lejos del centro es lo normal, no una incidencia. La ubicacion se sigue
-- guardando en cada fichaje (se ve en la ficha del trabajador y en las
-- exportaciones), pero ya NO convierte el fichaje en incidencia pendiente.

-- 1) Copia de seguridad de lo que se va a limpiar.
create schema if not exists backup_20261007;
create table if not exists backup_20261007.time_entries_ubicacion as
select * from public.time_entries
where workflow_status = 'pending'
  and flags->>'auto_incident_reason' in ('check_in_outside_workplace', 'check_out_outside_workplace');

-- 2) Entrada: se quita la rama que marcaba "pending" por estar fuera.
create or replace function public.create_checkin_server_time(
  p_company_id uuid, p_user_id uuid, p_status text, p_workflow_status text, p_flags jsonb,
  p_check_in_geo_lat double precision default null,
  p_check_in_geo_lng double precision default null,
  p_check_in_geo_accuracy_m double precision default null,
  p_check_in_geo_captured_at timestamptz default null
) returns time_entries
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_row public.time_entries;
  v_caller uuid := auth.uid();
  v_geo jsonb;
  v_flags jsonb;
  v_workflow text;
  v_tramos_hoy integer;
  v_motivo text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if v_caller is null then
      raise exception 'Tienes que iniciar sesion para fichar.';
    end if;
    if v_caller <> p_user_id then
      raise exception 'No puedes fichar por otra persona.';
    end if;
    if not exists (
      select 1 from public.memberships m
      where m.user_id = p_user_id and m.company_id = p_company_id and m.status = 'active'
    ) then
      raise exception 'No estas dado de alta en esta empresa.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('cerbero_fichaje:' || p_user_id::text));

  if exists (
    select 1 from public.time_entries t
    where t.user_id = p_user_id and t.company_id = p_company_id and t.check_out_at is null
  ) then
    raise exception 'Ya tienes una jornada abierta sin cerrar.';
  end if;

  select count(*) into v_tramos_hoy
  from public.time_entries t
  where t.user_id = p_user_id and t.company_id = p_company_id
    and (t.check_in_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date;

  v_geo := public.geo_verdict(p_company_id, p_check_in_geo_lat, p_check_in_geo_lng, p_check_in_geo_accuracy_m);

  v_flags := public.limpiar_marcas_cliente(p_flags)
    || v_geo
    || jsonb_build_object('servidor_tramos_hoy_previos', v_tramos_hoy)
    || public.marcas_geo_panel('check_in', v_geo);

  v_workflow := case when p_workflow_status = 'pending' then 'pending' else 'auto' end;
  v_motivo := v_flags->>'auto_incident_reason';

  if v_tramos_hoy >= 2 then
    v_workflow := 'pending';
    v_motivo := 'extra_daily_entry';
    v_flags := v_flags || jsonb_build_object('extra_daily_entry', true);
  end if;

  if v_workflow = 'pending' then
    v_flags := v_flags || jsonb_build_object('auto_incident', true, 'auto_incident_reason', coalesce(v_motivo, 'revision'));
  else
    v_flags := v_flags || jsonb_build_object('auto_incident', false, 'auto_incident_reason', null);
  end if;

  insert into public.time_entries (
    company_id, user_id, check_in_at, status, workflow_status, flags,
    check_in_geo_lat, check_in_geo_lng, check_in_geo_accuracy_m, check_in_geo_captured_at
  ) values (
    p_company_id, p_user_id, now(), 'open'::time_entry_status, v_workflow, v_flags,
    p_check_in_geo_lat, p_check_in_geo_lng, p_check_in_geo_accuracy_m, p_check_in_geo_captured_at
  )
  returning * into v_row;

  return v_row;
end;
$function$;

-- 3) Salida: se quitan el motivo "fuera del centro" y el arrastre de la
--    marca de la entrada.
create or replace function public.create_checkout_server_time(
  p_entry_id uuid, p_status text, p_workflow_status text, p_flags jsonb,
  p_check_out_geo_lat double precision default null,
  p_check_out_geo_lng double precision default null,
  p_check_out_geo_accuracy_m double precision default null,
  p_check_out_geo_captured_at timestamptz default null
) returns time_entries
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_row public.time_entries;
  v_existing public.time_entries;
  v_caller uuid := auth.uid();
  v_now timestamptz := now();
  v_geo jsonb;
  v_flags jsonb;
  v_workflow text;
  v_horas numeric;
  v_cruza_dia boolean;
  v_motivo text;
begin
  select * into v_existing from public.time_entries where id = p_entry_id for update;

  if not found then
    raise exception 'Esa jornada no existe.';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_caller is null then
      raise exception 'Tienes que iniciar sesion para fichar.';
    end if;
    if v_existing.user_id <> v_caller and not public.is_company_hr_or_owner(v_existing.company_id) then
      raise exception 'No puedes cerrar la jornada de otra persona.';
    end if;
  end if;

  if v_existing.check_out_at is not null then
    raise exception 'Esa jornada ya estaba cerrada.';
  end if;

  v_geo := public.geo_verdict(v_existing.company_id, p_check_out_geo_lat, p_check_out_geo_lng, p_check_out_geo_accuracy_m);

  v_horas := round((extract(epoch from (v_now - v_existing.check_in_at)) / 3600)::numeric, 2);
  v_cruza_dia := (v_existing.check_in_at at time zone 'Europe/Madrid')::date <> (v_now at time zone 'Europe/Madrid')::date;

  v_flags := public.limpiar_marcas_cliente(p_flags)
    || coalesce(v_existing.flags, '{}'::jsonb)
    || (select coalesce(jsonb_object_agg('salida_' || key, value), '{}'::jsonb) from jsonb_each(v_geo))
    || jsonb_build_object('servidor_horas_tramo', v_horas, 'servidor_cruza_dia', v_cruza_dia)
    || public.marcas_geo_panel('check_out', v_geo);

  v_motivo := case
    when v_cruza_dia then 'open_entry_crossed_day'
    when v_horas > 10 then 'open_entry_exceeded_hours'
    when v_horas < (2.0 / 60) then 'zero_length_shift'
    when v_horas > 7 then 'possible_missed_lunch_checkout'
    else null
  end;

  if v_motivo is not null
     or p_workflow_status = 'pending'
     or v_existing.workflow_status = 'pending' then
    v_workflow := 'pending';
    v_flags := v_flags || jsonb_build_object(
      'auto_incident', true,
      'auto_incident_reason', coalesce(v_motivo, v_existing.flags->>'auto_incident_reason', p_flags->>'auto_incident_reason', 'revision'));
  else
    v_workflow := 'auto';
    v_flags := v_flags || jsonb_build_object('auto_incident', false, 'auto_incident_reason', null);
  end if;

  update public.time_entries
  set check_out_at = v_now,
      status = 'closed'::time_entry_status,
      workflow_status = v_workflow,
      flags = v_flags,
      check_out_geo_lat = p_check_out_geo_lat,
      check_out_geo_lng = p_check_out_geo_lng,
      check_out_geo_accuracy_m = p_check_out_geo_accuracy_m,
      check_out_geo_captured_at = p_check_out_geo_captured_at
  where id = p_entry_id
  returning * into v_row;

  return v_row;
end;
$function$;

-- 4) Limpieza: los avisos de ubicacion que estaban pendientes pasan a
--    jornada normal. Las horas no se tocan; la ubicacion sigue en la ficha.
update public.time_entries
set workflow_status = 'auto',
    flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
      'auto_incident', false,
      'auto_incident_reason', null,
      'aviso_ubicacion_descartado', flags->>'auto_incident_reason',
      'aviso_ubicacion_descartado_at', now()
    )
where workflow_status = 'pending'
  and flags->>'auto_incident_reason' in ('check_in_outside_workplace', 'check_out_outside_workplace');
