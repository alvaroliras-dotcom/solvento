-- =====================================================================
-- Cerbero · 2 de octubre de 2026 · Cerrar accesos
--
-- Antes de esto, cualquiera con la clave publica de la app (va dentro del
-- codigo que descarga el navegador), sin iniciar sesion, podia:
--   - leer nombre, email y rol de toda la plantilla,
--   - fichar la entrada o cerrar la jornada de cualquier trabajador,
--   - crear incidencias falsas y consultar la asistencia del dia.
-- Y un trabajador podia escribir directamente en sus fichajes (horas,
-- estado y marcas de incidencia) sin pasar por la hora del servidor.
--
-- Copia de seguridad previa: esquema backup_20261002 (tablas, funciones
-- y politicas tal como estaban).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vista que exponia los datos de todos los usuarios
-- ---------------------------------------------------------------------
alter view public.v_profiles_with_company set (security_invoker = on);
revoke all on public.v_profiles_with_company from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Quien es miembro / admin: solo cuenta el alta activa.
--    Los ex-trabajadores (status distinto de 'active') pasaban las
--    comprobaciones de seguridad igual que los de alta.
-- ---------------------------------------------------------------------
create or replace function public.is_company_hr_or_owner(p_company_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
      and m.status = 'active'
  );
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.is_member_of_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.company_id = p_company_id
      and m.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Listados de plantilla: solo para administracion de esa empresa
-- ---------------------------------------------------------------------
create or replace function public.admin_company_profiles(p_company_id uuid)
returns table(id uuid, email text, full_name text)
language sql
security definer
set search_path = public
as $$
  select p.id as id, p.email, p.full_name
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
    and m.status = 'active'
    and public.is_company_hr_or_owner(p_company_id)
  order by lower(coalesce(p.full_name, p.email, p.id::text));
$$;

create or replace function public.admin_company_profiles_all(p_company_id uuid)
returns table(id uuid, email text, full_name text, status text, ended_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.id as id, p.email, p.full_name, m.status, m.ended_at
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
    and public.is_company_hr_or_owner(p_company_id)
  order by lower(coalesce(p.full_name, p.email, p.id::text));
$$;

-- ---------------------------------------------------------------------
-- 4. Fichar entrada y salida
--
--  - Hace falta sesion iniciada (o ser el servidor).
--  - El servidor decide el estado y las marcas de incidencia: el movil
--    puede pedir "pendiente", pero nunca quitar una incidencia ni marcar
--    la jornada como ajustada.
--  - Los fichajes del mismo trabajador se hacen de uno en uno, y no puede
--    haber dos jornadas abiertas a la vez (indice unico).
--  - Los dias se cuentan en hora de Madrid, no en la del movil.
-- ---------------------------------------------------------------------

-- Quita de las marcas que manda el movil las que solo puede poner el
-- servidor o administracion.
create or replace function public.limpiar_marcas_cliente(p_flags jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(coalesce(p_flags, '{}'::jsonb))
  where key !~ '^(servidor_|salida_servidor_|admin_)'
    and key not in (
      'registrada_por_administracion',
      'incident_closed_from_backoffice',
      'cierre_manual'
    );
$$;

create unique index if not exists time_entries_una_abierta_por_trabajador
  on public.time_entries (user_id, company_id)
  where check_out_at is null;

create or replace function public.create_checkin_server_time(
  p_company_id uuid,
  p_user_id uuid,
  p_status text,
  p_workflow_status text,
  p_flags jsonb,
  p_check_in_geo_lat double precision default null,
  p_check_in_geo_lng double precision default null,
  p_check_in_geo_accuracy_m double precision default null,
  p_check_in_geo_captured_at timestamptz default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
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
      where m.user_id = p_user_id
        and m.company_id = p_company_id
        and m.status = 'active'
    ) then
      raise exception 'No estas dado de alta en esta empresa.';
    end if;
  end if;

  -- De uno en uno por trabajador: dos toques o dos moviles a la vez ya no
  -- crean dos jornadas.
  perform pg_advisory_xact_lock(hashtext('cerbero_fichaje:' || p_user_id::text));

  if exists (
    select 1 from public.time_entries t
    where t.user_id = p_user_id
      and t.company_id = p_company_id
      and t.check_out_at is null
  ) then
    raise exception 'Ya tienes una jornada abierta sin cerrar.';
  end if;

  select count(*) into v_tramos_hoy
  from public.time_entries t
  where t.user_id = p_user_id
    and t.company_id = p_company_id
    and (t.check_in_at at time zone 'Europe/Madrid')::date
        = (now() at time zone 'Europe/Madrid')::date;

  v_geo := public.geo_verdict(
    p_company_id, p_check_in_geo_lat, p_check_in_geo_lng, p_check_in_geo_accuracy_m
  );

  v_flags := public.limpiar_marcas_cliente(p_flags)
    || v_geo
    || jsonb_build_object('servidor_tramos_hoy_previos', v_tramos_hoy);

  v_workflow := case when p_workflow_status = 'pending' then 'pending' else 'auto' end;
  v_motivo := v_flags->>'auto_incident_reason';

  if v_tramos_hoy >= 2 then
    v_workflow := 'pending';
    v_motivo := 'extra_daily_entry';
    v_flags := v_flags || jsonb_build_object('extra_daily_entry', true);
  elsif coalesce((v_geo->>'servidor_fuera')::boolean, false) then
    v_workflow := 'pending';
    v_motivo := coalesce(v_motivo, 'check_in_outside_workplace');
  end if;

  if v_workflow = 'pending' then
    v_flags := v_flags || jsonb_build_object(
      'auto_incident', true,
      'auto_incident_reason', coalesce(v_motivo, 'revision')
    );
  else
    v_flags := v_flags || jsonb_build_object(
      'auto_incident', false,
      'auto_incident_reason', null
    );
  end if;

  insert into public.time_entries (
    company_id, user_id, check_in_at, status, workflow_status, flags,
    check_in_geo_lat, check_in_geo_lng,
    check_in_geo_accuracy_m, check_in_geo_captured_at
  )
  values (
    p_company_id, p_user_id, now(), 'open'::time_entry_status,
    v_workflow, v_flags,
    p_check_in_geo_lat, p_check_in_geo_lng,
    p_check_in_geo_accuracy_m, p_check_in_geo_captured_at
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.create_checkout_server_time(
  p_entry_id uuid,
  p_status text,
  p_workflow_status text,
  p_flags jsonb,
  p_check_out_geo_lat double precision default null,
  p_check_out_geo_lng double precision default null,
  p_check_out_geo_accuracy_m double precision default null,
  p_check_out_geo_captured_at timestamptz default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
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
  -- FOR UPDATE: si llegan dos salidas a la vez, la segunda espera y ve la
  -- jornada ya cerrada en lugar de volver a escribir la hora.
  select * into v_existing
  from public.time_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Esa jornada no existe.';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if v_caller is null then
      raise exception 'Tienes que iniciar sesion para fichar.';
    end if;
    if v_existing.user_id <> v_caller
       and not public.is_company_hr_or_owner(v_existing.company_id) then
      raise exception 'No puedes cerrar la jornada de otra persona.';
    end if;
  end if;

  if v_existing.check_out_at is not null then
    raise exception 'Esa jornada ya estaba cerrada.';
  end if;

  v_geo := public.geo_verdict(
    v_existing.company_id, p_check_out_geo_lat, p_check_out_geo_lng, p_check_out_geo_accuracy_m
  );

  v_horas := round((extract(epoch from (v_now - v_existing.check_in_at)) / 3600)::numeric, 2);
  v_cruza_dia := (v_existing.check_in_at at time zone 'Europe/Madrid')::date
                 <> (v_now at time zone 'Europe/Madrid')::date;

  -- Las marcas que ya tenia la jornada (las de la entrada y las del
  -- servidor) se conservan; las del movil no pueden pisarlas.
  v_flags := public.limpiar_marcas_cliente(p_flags)
    || coalesce(v_existing.flags, '{}'::jsonb)
    || (select coalesce(jsonb_object_agg('salida_' || key, value), '{}'::jsonb)
        from jsonb_each(v_geo))
    || jsonb_build_object(
         'servidor_horas_tramo', v_horas,
         'servidor_cruza_dia', v_cruza_dia
       );

  v_motivo := case
    when v_cruza_dia then 'open_entry_crossed_day'
    when v_horas > 10 then 'open_entry_exceeded_hours'
    when v_horas < (2.0 / 60) then 'zero_length_shift'
    when v_horas > 7 then 'possible_missed_lunch_checkout'
    when coalesce((v_geo->>'servidor_fuera')::boolean, false) then 'check_out_outside_workplace'
    else null
  end;

  if v_motivo is not null
     or p_workflow_status = 'pending'
     or v_existing.workflow_status = 'pending'
     or coalesce((v_existing.flags->>'servidor_fuera')::boolean, false) then
    v_workflow := 'pending';
    v_flags := v_flags || jsonb_build_object(
      'auto_incident', true,
      'auto_incident_reason',
        coalesce(v_motivo, v_existing.flags->>'auto_incident_reason',
                 p_flags->>'auto_incident_reason', 'revision')
    );
  else
    v_workflow := 'auto';
    v_flags := v_flags || jsonb_build_object(
      'auto_incident', false,
      'auto_incident_reason', null
    );
  end if;

  update public.time_entries
  set
    check_out_at = v_now,
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
$$;

-- El trabajador ya no escribe directamente en sus fichajes: solo a traves
-- de las dos funciones de arriba. Administracion conserva su politica.
drop policy if exists time_entries_insert_own on public.time_entries;
drop policy if exists time_entries_update_checkout_only on public.time_entries;

-- ---------------------------------------------------------------------
-- 5. Validar un ajuste: la salida tiene que ser posterior a la entrada,
--    y la jornada queda cerrada (habia 9 con salida pero estado "open").
-- ---------------------------------------------------------------------
create or replace function public.resolve_time_entry_adjustment(
  p_adjustment_id uuid,
  p_decision text,
  p_resolution_reason text,
  p_final_check_out timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_time_entry_id uuid;
  v_check_in timestamptz;
  v_proposed_check_out timestamptz;
  v_old_check_out timestamptz;
  v_final timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_decision not in ('validated', 'rejected') then
    raise exception 'invalid decision';
  end if;

  if p_resolution_reason is null or length(trim(p_resolution_reason)) < 3 then
    raise exception 'resolution reason required';
  end if;

  select te.company_id, te.id, te.check_in_at, a.proposed_check_out, te.check_out_at
  into v_company_id, v_time_entry_id, v_check_in, v_proposed_check_out, v_old_check_out
  from public.time_entry_adjustments a
  join public.time_entries te on te.id = a.time_entry_id
  where a.id = p_adjustment_id
    and a.status = 'pending'
  for update of a, te;

  if not found then
    raise exception 'adjustment not found or not pending';
  end if;

  if not public.is_company_hr_or_owner(v_company_id) then
    raise exception 'forbidden';
  end if;

  v_final := coalesce(p_final_check_out, v_proposed_check_out);

  if p_decision = 'validated' and (v_final is null or v_final <= v_check_in) then
    raise exception 'La hora de salida tiene que ser posterior a la de entrada.';
  end if;

  update public.time_entry_adjustments
  set
    status = p_decision,
    resolved_by = v_user_id,
    resolved_at = now(),
    final_check_out = case when p_decision = 'validated' then v_final else null end,
    reason = reason || ' | RESOLUCIÓN: ' || trim(p_resolution_reason)
  where id = p_adjustment_id;

  if p_decision = 'validated' then
    update public.time_entries
    set
      check_out_at = v_final,
      status = 'closed'::time_entry_status,
      workflow_status = 'adjusted',
      flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
        'admin_resolution_decision', 'validated',
        'admin_resolution_reason', trim(p_resolution_reason),
        'admin_resolution_at', now(),
        'admin_old_check_out_at', v_old_check_out,
        'admin_new_check_out_at', v_final
      )
    where id = v_time_entry_id;

    insert into public.time_entry_logs (
      company_id, time_entry_id, action, performed_by, performed_role,
      old_values, new_values
    ) values (
      v_company_id, v_time_entry_id, 'adjustment_validated', v_user_id, 'admin',
      jsonb_build_object('check_out_at', v_old_check_out, 'workflow_status', 'pending'),
      jsonb_build_object(
        'check_out_at', v_final,
        'workflow_status', 'adjusted',
        'resolution_reason', trim(p_resolution_reason)
      )
    );
  else
    update public.time_entries
    set
      workflow_status = 'rejected',
      flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
        'admin_resolution_decision', 'rejected',
        'admin_resolution_reason', trim(p_resolution_reason),
        'admin_resolution_at', now()
      )
    where id = v_time_entry_id;

    insert into public.time_entry_logs (
      company_id, time_entry_id, action, performed_by, performed_role,
      old_values, new_values
    ) values (
      v_company_id, v_time_entry_id, 'adjustment_rejected', v_user_id, 'admin',
      jsonb_build_object('workflow_status', 'pending'),
      jsonb_build_object(
        'workflow_status', 'rejected',
        'resolution_reason', trim(p_resolution_reason)
      )
    );
  end if;
end;
$$;

-- Las jornadas antiguas con salida anterior o igual a la entrada no se
-- tocan (la regla time_entries_salida_posterior lo impide): tiene que
-- revisarlas administracion.
update public.time_entries
set status = 'closed'::time_entry_status
where status = 'open'
  and check_out_at is not null
  and check_out_at > check_in_at;

-- ---------------------------------------------------------------------
-- 6. Solicitudes del trabajador (vacaciones, etc.)
--    Antes podia crearlas ya "aprobadas" o en otra empresa. Y el boton
--    de borrar de administracion no borraba nada (faltaba el permiso).
-- ---------------------------------------------------------------------
drop policy if exists worker_requests_insert_own on public.worker_requests;
create policy worker_requests_insert_own on public.worker_requests
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and read_at is null
    and public.is_company_member(company_id)
  );

drop policy if exists worker_requests_delete_admin on public.worker_requests;
create policy worker_requests_delete_admin on public.worker_requests
  for delete to authenticated
  using (public.is_company_hr_or_owner(company_id));

-- ---------------------------------------------------------------------
-- 7. Permisos de ejecucion
--    Ninguna funcion se puede llamar sin sesion. Las que solo usa la tarea
--    automatica (cron) o el propio servidor, tampoco con sesion.
-- ---------------------------------------------------------------------
do $$
declare
  f record;
  solo_servidor text[] := array[
    'get_incident_candidates', 'get_missing_checkin_incident_candidates',
    'get_missing_checkin_notifications', 'get_long_open_shift_candidates',
    'get_long_open_shift_notifications', 'get_missing_lunch_checkout_notifications',
    'get_missing_lunch_checkin_notifications', 'get_missing_final_checkout_notifications',
    'get_morning_checkin_reminders', 'get_lunch_checkout_reminders',
    'get_lunch_checkin_reminders', 'get_final_checkout_reminders',
    'create_missing_checkin_incident', 'create_missing_lunch_checkout_incident',
    'create_missing_afternoon_checkin_incident', 'create_missing_final_checkout_incident',
    'create_late_checkin_incident', 'create_late_lunch_checkout_incident',
    'create_late_afternoon_checkin_incident', 'create_late_final_checkout_incident',
    'log_push_notification', 'push_already_sent',
    'geo_verdict', 'geo_distance_m', 'company_is_working_day', 'worker_is_absent_on',
    'handle_new_user', 'proteger_hora_entrada', 'set_updated_at',
    'limpiar_marcas_cliente'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname = any (solo_servidor) then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Las funciones nuevas que se creen en el futuro no seran publicas por
-- defecto.
alter default privileges in schema public revoke execute on functions from public, anon;
