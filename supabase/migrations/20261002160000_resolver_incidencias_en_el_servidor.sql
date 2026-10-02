-- =====================================================================
-- Cerbero · 2 de octubre de 2026 · Resolver incidencias en el servidor
--
-- 1. resolve_automatic_incident (nueva). El panel resolvia las incidencias
--    automaticas con un UPDATE directo desde el navegador y el registro de
--    auditoria en una llamada aparte:
--      - si fallaba el registro, el cambio quedaba sin rastro;
--      - dos administradores a la vez se pisaban;
--      - las marcas del fichaje se reescribian con la copia del navegador;
--      - validar o rechazar una jornada abierta la dejaba abierta, y al dia
--        siguiente el trabajador no podia fichar.
--    Ahora todo va en una sola operacion, bloqueando la jornada.
--
-- 2. resolve_time_entry_adjustment acepta tambien la hora de ENTRADA
--    corregida (antes se aplicaba aparte desde el navegador, en dos pasos).
--
-- 3. Las funciones de administracion solo valen para owner/admin con alta
--    activa (antes un administrador dado de baja conservaba el poder).
--    resolve_time_entry_request guarda el motivo de la resolucion.
--    admin_save_time_entry comprueba que el trabajador es de la empresa.
-- =====================================================================

create or replace function public.resolve_automatic_incident(
  p_time_entry_id uuid,
  p_decision text,
  p_resolution_reason text,
  p_check_in timestamptz default null,
  p_check_out timestamptz default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_old public.time_entries;
  v_row public.time_entries;
  v_in timestamptz;
  v_out timestamptz;
begin
  if v_admin is null then
    raise exception 'No hay sesion iniciada.';
  end if;

  if p_decision not in ('validated', 'rejected') then
    raise exception 'Decision no valida.';
  end if;

  if p_resolution_reason is null or length(trim(p_resolution_reason)) < 3 then
    raise exception 'El motivo de resolucion es obligatorio (minimo 3 caracteres).';
  end if;

  select * into v_old from public.time_entries where id = p_time_entry_id for update;

  if not found then
    raise exception 'Esa jornada no existe.';
  end if;

  if not public.is_company_hr_or_owner(v_old.company_id) then
    raise exception 'Solo administracion puede resolver incidencias.';
  end if;

  if v_old.workflow_status <> 'pending' then
    raise exception 'Esta incidencia ya la ha resuelto otra persona. Recarga la lista.';
  end if;

  v_in := case when p_decision = 'validated' then coalesce(p_check_in, v_old.check_in_at)
               else v_old.check_in_at end;
  v_out := coalesce(case when p_decision = 'validated' then p_check_out end,
                    v_old.check_out_at,
                    p_check_out);

  if v_out is null then
    raise exception 'La jornada sigue abierta: indica la hora de salida para poder cerrarla.';
  end if;

  if v_out <= v_in then
    raise exception 'La hora de salida tiene que ser posterior a la de entrada.';
  end if;

  update public.time_entries
  set
    check_in_at = v_in,
    check_out_at = v_out,
    status = 'closed'::time_entry_status,
    workflow_status = case when p_decision = 'validated' then 'adjusted' else 'rejected' end,
    flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
      'admin_resolution_decision', p_decision,
      'admin_resolution_reason', trim(p_resolution_reason),
      'admin_resolution_at', now(),
      'admin_old_check_out_at', v_old.check_out_at,
      'admin_new_check_out_at', v_out,
      'incident_closed_from_backoffice', true
    )
  where id = p_time_entry_id
  returning * into v_row;

  insert into public.time_entry_logs (
    company_id, time_entry_id, action, performed_by, performed_role,
    old_values, new_values
  ) values (
    v_old.company_id, v_old.id,
    (case when p_decision = 'validated' then 'automatic_incident_validated'
          else 'automatic_incident_rejected' end)::time_log_action,
    v_admin, 'admin',
    jsonb_build_object(
      'check_in_at', v_old.check_in_at,
      'check_out_at', v_old.check_out_at,
      'workflow_status', v_old.workflow_status
    ),
    jsonb_build_object(
      'check_in_at', v_in,
      'check_out_at', v_out,
      'workflow_status', v_row.workflow_status,
      'resolution_reason', trim(p_resolution_reason)
    )
  );

  -- Las solicitudes que colgaban de esta jornada quedan resueltas igual.
  update public.time_entry_requests
  set status = (case when p_decision = 'validated' then 'approved' else 'rejected' end)::time_request_status,
      resolved_by = v_admin,
      resolved_at = now(),
      resolution_reason = trim(p_resolution_reason)
  where time_entry_id = v_old.id
    and status = 'pending';

  return v_row;
end;
$$;

revoke execute on function public.resolve_automatic_incident(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.resolve_automatic_incident(uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- resolve_time_entry_adjustment con hora de entrada opcional
-- ---------------------------------------------------------------------
drop function if exists public.resolve_time_entry_adjustment(uuid, text, text, timestamptz);

create or replace function public.resolve_time_entry_adjustment(
  p_adjustment_id uuid,
  p_decision text,
  p_resolution_reason text,
  p_final_check_out timestamptz default null,
  p_final_check_in timestamptz default null
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
  v_final_in timestamptz;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if p_decision not in ('validated', 'rejected') then raise exception 'invalid decision'; end if;
  if p_resolution_reason is null or length(trim(p_resolution_reason)) < 3 then
    raise exception 'resolution reason required';
  end if;

  select te.company_id, te.id, te.check_in_at, a.proposed_check_out, te.check_out_at
  into v_company_id, v_time_entry_id, v_check_in, v_proposed_check_out, v_old_check_out
  from public.time_entry_adjustments a
  join public.time_entries te on te.id = a.time_entry_id
  where a.id = p_adjustment_id and a.status = 'pending'
  for update of a, te;

  if not found then raise exception 'Esta solicitud ya esta resuelta o no existe. Recarga la lista.'; end if;
  if not public.is_company_hr_or_owner(v_company_id) then raise exception 'forbidden'; end if;

  v_final := coalesce(p_final_check_out, v_proposed_check_out);
  v_final_in := coalesce(p_final_check_in, v_check_in);

  if p_decision = 'validated' and (v_final is null or v_final <= v_final_in) then
    raise exception 'La hora de salida tiene que ser posterior a la de entrada.';
  end if;

  update public.time_entry_adjustments
  set status = p_decision, resolved_by = v_user_id, resolved_at = now(),
      final_check_out = case when p_decision = 'validated' then v_final else null end,
      reason = reason || ' | RESOLUCIÓN: ' || trim(p_resolution_reason)
  where id = p_adjustment_id;

  if p_decision = 'validated' then
    update public.time_entries
    set check_in_at = v_final_in,
        check_out_at = v_final,
        status = 'closed'::time_entry_status,
        workflow_status = 'adjusted',
        flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
          'admin_resolution_decision', 'validated',
          'admin_resolution_reason', trim(p_resolution_reason),
          'admin_resolution_at', now(),
          'admin_old_check_out_at', v_old_check_out,
          'admin_new_check_out_at', v_final)
    where id = v_time_entry_id;

    insert into public.time_entry_logs (company_id, time_entry_id, action, performed_by, performed_role, old_values, new_values)
    values (v_company_id, v_time_entry_id, 'adjustment_validated', v_user_id, 'admin',
      jsonb_build_object('check_in_at', v_check_in, 'check_out_at', v_old_check_out, 'workflow_status', 'pending'),
      jsonb_build_object('check_in_at', v_final_in, 'check_out_at', v_final, 'workflow_status', 'adjusted',
                         'resolution_reason', trim(p_resolution_reason)));
  else
    update public.time_entries
    set workflow_status = 'rejected',
        flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
          'admin_resolution_decision', 'rejected',
          'admin_resolution_reason', trim(p_resolution_reason),
          'admin_resolution_at', now())
    where id = v_time_entry_id;

    insert into public.time_entry_logs (company_id, time_entry_id, action, performed_by, performed_role, old_values, new_values)
    values (v_company_id, v_time_entry_id, 'adjustment_rejected', v_user_id, 'admin',
      jsonb_build_object('workflow_status', 'pending'),
      jsonb_build_object('workflow_status', 'rejected', 'resolution_reason', trim(p_resolution_reason)));
  end if;
end;
$$;

revoke execute on function public.resolve_time_entry_adjustment(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.resolve_time_entry_adjustment(uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- resolve_time_entry_request: solo admin activo y guarda el motivo
-- ---------------------------------------------------------------------
create or replace function public.resolve_time_entry_request(
  p_request_id uuid, p_decision text, p_resolution_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if p_decision not in ('validated', 'rejected') then raise exception 'invalid decision'; end if;
  if p_resolution_reason is null or length(trim(p_resolution_reason)) < 3 then
    raise exception 'resolution reason required';
  end if;

  select company_id into v_company_id
  from public.time_entry_requests
  where id = p_request_id and status = 'pending'
  for update;

  if not found then raise exception 'Esta incidencia ya esta resuelta o no existe. Recarga la lista.'; end if;
  if not public.is_company_hr_or_owner(v_company_id) then raise exception 'forbidden'; end if;

  update public.time_entry_requests
  set status = (case when p_decision = 'validated' then 'approved' else 'rejected' end)::public.time_request_status,
      resolved_by = v_user_id,
      resolved_at = now(),
      resolution_reason = trim(p_resolution_reason)
  where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_pending_adjustments: solo admin activo
-- ---------------------------------------------------------------------
create or replace function public.admin_pending_adjustments(p_company_id uuid)
returns table(adjustment_id uuid, time_entry_id uuid, user_id uuid, check_in_at timestamptz,
              proposed_check_out timestamptz, reason text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select a.id, te.id, te.user_id, te.check_in_at, a.proposed_check_out, a.reason, a.created_at
  from public.time_entry_adjustments a
  join public.time_entries te on te.id = a.time_entry_id
  where te.company_id = p_company_id
    and a.status = 'pending'
    and public.is_company_hr_or_owner(p_company_id)
  order by a.created_at asc;
$$;

-- ---------------------------------------------------------------------
-- admin_save_time_entry: admin activo, trabajador de la empresa
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := replace(pg_get_functiondef('public.admin_save_time_entry'::regproc), E'\r', '');

  v_def := replace(v_def,
$a$  if not exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = v_admin
      and m.role in ('admin','owner')
  ) then$a$,
$b$  if not public.is_company_hr_or_owner(p_company_id) then$b$);

  v_def := replace(v_def,
$a$  if p_check_in is null then$a$,
$b$  if not exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = p_user_id
  ) then
    raise exception 'Ese trabajador no pertenece a esta empresa.';
  end if;
  if p_check_in is null then$b$);

  v_def := replace(v_def,
$a$    select * into v_old from public.time_entries where id = p_time_entry_id;$a$,
$b$    select * into v_old from public.time_entries where id = p_time_entry_id for update;$b$);

  v_def := replace(v_def,
$a$    if v_old.company_id <> p_company_id then
      raise exception 'Esa jornada no pertenece a esta empresa.';
    end if;$a$,
$b$    if v_old.company_id <> p_company_id then
      raise exception 'Esa jornada no pertenece a esta empresa.';
    end if;
    if v_old.user_id <> p_user_id then
      raise exception 'Esa jornada es de otro trabajador.';
    end if;$b$);

  if v_def !~ 'is_company_hr_or_owner' or v_def !~ 'Ese trabajador no pertenece'
     or v_def !~ 'for update;' or v_def !~ 'es de otro trabajador' then
    raise exception 'admin_save_time_entry: algun patron no se encontro';
  end if;
  execute v_def;
end $$;
