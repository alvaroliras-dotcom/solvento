-- Al corregir una jornada desde la ficha del trabajador (admin_save_time_entry)
-- se cerraba la jornada y sus solicitudes de fichaje, pero NO los ajustes
-- pendientes (time_entry_adjustments) de esa misma jornada. Esos ajustes
-- seguian contando como "incidencia pendiente" en la portada del panel
-- aunque el problema ya estuviera arreglado.

create or replace function public.admin_save_time_entry(
  p_company_id uuid,
  p_user_id uuid,
  p_check_in timestamp with time zone,
  p_check_out timestamp with time zone,
  p_reason text,
  p_time_entry_id uuid default null::uuid
) returns time_entries
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := auth.uid();
  v_row public.time_entries;
  v_old public.time_entries;
begin
  if v_admin is null then
    raise exception 'No autenticado.';
  end if;
  if not public.is_company_hr_or_owner(p_company_id) then
    raise exception 'Solo administracion puede registrar o corregir jornadas.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Hay que indicar el motivo (minimo 3 caracteres).';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = p_user_id
  ) then
    raise exception 'Ese trabajador no pertenece a esta empresa.';
  end if;
  if p_check_in is null then
    raise exception 'Falta la hora de entrada.';
  end if;
  if p_check_out is not null and p_check_out <= p_check_in then
    raise exception 'La salida tiene que ser posterior a la entrada.';
  end if;
  if p_time_entry_id is null then
    insert into public.time_entries (
      company_id, user_id, check_in_at, check_out_at,
      status, workflow_status, flags
    ) values (
      p_company_id, p_user_id, p_check_in, p_check_out,
      (case when p_check_out is null then 'open' else 'closed' end)::time_entry_status,
      'adjusted',
      jsonb_build_object(
        'registrada_por_administracion', true,
        'admin_resolution_decision', 'validated',
        'admin_resolution_reason', trim(p_reason),
        'admin_resolution_at', now()
      )
    )
    returning * into v_row;
    insert into public.time_entry_logs (
      company_id, time_entry_id, action, performed_by, performed_role,
      old_values, new_values
    ) values (
      p_company_id, v_row.id, 'created', v_admin, 'admin',
      '{}'::jsonb,
      jsonb_build_object(
        'check_in_at', p_check_in,
        'check_out_at', p_check_out,
        'motivo', trim(p_reason),
        'origen', 'alta manual desde administracion'
      )
    );
  else
    select * into v_old from public.time_entries where id = p_time_entry_id for update;
    if not found then
      raise exception 'Esa jornada no existe.';
    end if;
    if v_old.company_id <> p_company_id then
      raise exception 'Esa jornada no pertenece a esta empresa.';
    end if;
    if v_old.user_id <> p_user_id then
      raise exception 'Esa jornada es de otro trabajador.';
    end if;
    update public.time_entries
    set
      check_in_at  = p_check_in,
      check_out_at = p_check_out,
      status = (case when p_check_out is null then 'open' else 'closed' end)::time_entry_status,
      workflow_status = 'adjusted',
      flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
        'corregida_por_administracion', true,
        'admin_resolution_decision', 'validated',
        'admin_resolution_reason', trim(p_reason),
        'admin_resolution_at', now()
      )
    where id = p_time_entry_id
    returning * into v_row;
    insert into public.time_entry_logs (
      company_id, time_entry_id, action, performed_by, performed_role,
      old_values, new_values
    ) values (
      p_company_id, v_row.id, 'adjustment_validated', v_admin, 'admin',
      jsonb_build_object(
        'check_in_at', v_old.check_in_at,
        'check_out_at', v_old.check_out_at
      ),
      jsonb_build_object(
        'check_in_at', p_check_in,
        'check_out_at', p_check_out,
        'motivo', trim(p_reason),
        'origen', 'correccion manual desde administracion'
      )
    );

    -- NUEVO: los ajustes pendientes de esta jornada quedan resueltos.
    update public.time_entry_adjustments a
    set status = 'validated',
        resolved_by = v_admin,
        resolved_at = now(),
        final_check_out = p_check_out,
        reason = a.reason || ' | RESOLUCIÓN: ' || trim(p_reason)
    where a.time_entry_id = v_row.id
      and a.status = 'pending';
  end if;
  update public.time_entry_requests r
  set
    status = 'approved',
    resolved_by = v_admin,
    resolved_at = now(),
    resolution_reason = trim(p_reason)
  where r.company_id = p_company_id
    and r.status = 'pending'
    and (
      r.time_entry_id = v_row.id
      or (
        r.requested_by = p_user_id
        and (r.requested_at at time zone 'Europe/Madrid')::date
            = (v_row.check_in_at at time zone 'Europe/Madrid')::date
      )
    );
  return v_row;
end;
$function$;

-- Limpieza de lo ya acumulado: ajustes pendientes cuya jornada ya se
-- resolvio por otro camino (hoy son 3). Se cierran con la misma decision
-- que tiene la jornada.
update public.time_entry_adjustments a
set status = case t.workflow_status when 'rejected' then 'rejected' else 'validated' end,
    resolved_at = now(),
    final_check_out = case t.workflow_status when 'rejected' then null else t.check_out_at end,
    reason = a.reason || ' | RESOLUCIÓN: jornada ya resuelta desde la ficha del trabajador'
from public.time_entries t
where t.id = a.time_entry_id
  and a.status = 'pending'
  and t.workflow_status in ('adjusted', 'rejected');
