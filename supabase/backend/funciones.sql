CREATE OR REPLACE FUNCTION public.admin_company_profiles(p_company_id uuid)
 RETURNS TABLE(id uuid, email text, full_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id as id, p.email, p.full_name
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
    and m.status = 'active'
  order by lower(coalesce(p.full_name, p.email, p.id::text));
$function$
;

CREATE OR REPLACE FUNCTION public.admin_company_profiles_all(p_company_id uuid)
 RETURNS TABLE(id uuid, email text, full_name text, status text, ended_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id as id, p.email, p.full_name, m.status, m.ended_at
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
  order by lower(coalesce(p.full_name, p.email, p.id::text));
$function$
;

CREATE OR REPLACE FUNCTION public.admin_pending_adjustments(p_company_id uuid)
 RETURNS TABLE(adjustment_id uuid, time_entry_id uuid, user_id uuid, check_in_at timestamp with time zone, proposed_check_out timestamp with time zone, reason text, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    a.id as adjustment_id,
    te.id as time_entry_id,
    te.user_id,
    te.check_in_at,
    a.proposed_check_out,
    a.reason,
    a.created_at
  from public.time_entry_adjustments a
  join public.time_entries te on te.id = a.time_entry_id
  where te.company_id = p_company_id
    and a.status = 'pending'
    and exists (
      select 1
      from public.memberships m
      where m.company_id = p_company_id
        and m.user_id = auth.uid()
        and m.role in ('admin','owner')
    )
  order by a.created_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_save_time_entry(p_company_id uuid, p_user_id uuid, p_check_in timestamp with time zone, p_check_out timestamp with time zone, p_reason text, p_time_entry_id uuid DEFAULT NULL::uuid)
 RETURNS time_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := auth.uid();
  v_row public.time_entries;
  v_old public.time_entries;
begin
  if v_admin is null then
    raise exception 'No autenticado.';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = v_admin
      and m.role in ('admin','owner')
  ) then
    raise exception 'Solo administracion puede registrar o corregir jornadas.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Hay que indicar el motivo (minimo 3 caracteres).';
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
    select * into v_old from public.time_entries where id = p_time_entry_id;
    if not found then
      raise exception 'Esa jornada no existe.';
    end if;
    if v_old.company_id <> p_company_id then
      raise exception 'Esa jornada no pertenece a esta empresa.';
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
$function$
;

CREATE OR REPLACE FUNCTION public.company_is_working_day(p_company_id uuid, p_target_date date)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare
  v_dow int;
  v_works_on_saturday boolean := false;
  v_works_on_sunday boolean := false;
  v_is_holiday boolean := false;
begin
  select
    coalesce(c.works_on_saturday, false),
    coalesce(c.works_on_sunday, false)
  into
    v_works_on_saturday,
    v_works_on_sunday
  from public.company_work_calendar c
  where c.company_id = p_company_id;

  v_dow := extract(dow from p_target_date);

  if v_dow = 0 and not v_works_on_sunday then
    return false;
  end if;

  if v_dow = 6 and not v_works_on_saturday then
    return false;
  end if;

  select exists (
    select 1
    from public.company_holidays h
    where h.company_id = p_company_id
      and h.holiday_date = p_target_date
  )
  into v_is_holiday;

  if v_is_holiday then
    return false;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_checkin_server_time(p_company_id uuid, p_user_id uuid, p_status text, p_workflow_status text, p_flags jsonb, p_check_in_geo_lat double precision DEFAULT NULL::double precision, p_check_in_geo_lng double precision DEFAULT NULL::double precision, p_check_in_geo_accuracy_m double precision DEFAULT NULL::double precision, p_check_in_geo_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS time_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.time_entries;
  v_caller uuid := auth.uid();
begin
  -- Nadie puede fichar en nombre de otra persona.
  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'No puedes fichar por otra persona.';
  end if;

  -- Solo se ficha en una empresa en la que se esta de alta.
  if v_caller is not null and not exists (
    select 1 from public.memberships m
    where m.user_id = p_user_id
      and m.company_id = p_company_id
      and m.status = 'active'
  ) then
    raise exception 'No estas dado de alta en esta empresa.';
  end if;

  -- No se puede tener dos jornadas abiertas a la vez.
  -- Esto es lo que evita el fichaje duplicado por doble toque.
  if exists (
    select 1 from public.time_entries t
    where t.user_id = p_user_id
      and t.company_id = p_company_id
      and t.check_out_at is null
  ) then
    raise exception 'Ya tienes una jornada abierta sin cerrar.';
  end if;

  insert into public.time_entries (
    company_id, user_id, check_in_at, status, workflow_status, flags,
    check_in_geo_lat, check_in_geo_lng,
    check_in_geo_accuracy_m, check_in_geo_captured_at
  )
  values (
    p_company_id, p_user_id, now(), p_status::time_entry_status,
    p_workflow_status, p_flags,
    p_check_in_geo_lat, p_check_in_geo_lng,
    p_check_in_geo_accuracy_m, p_check_in_geo_captured_at
  )
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_checkout_server_time(p_entry_id uuid, p_status text, p_workflow_status text, p_flags jsonb, p_check_out_geo_lat double precision DEFAULT NULL::double precision, p_check_out_geo_lng double precision DEFAULT NULL::double precision, p_check_out_geo_accuracy_m double precision DEFAULT NULL::double precision, p_check_out_geo_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS time_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.time_entries;
  v_existing public.time_entries;
  v_caller uuid := auth.uid();
begin
  select * into v_existing
  from public.time_entries
  where id = p_entry_id;

  if not found then
    raise exception 'Esa jornada no existe.';
  end if;

  -- Solo el dueno de la jornada, o un administrador de su empresa.
  if v_caller is not null
     and v_existing.user_id <> v_caller
     and not public.is_company_hr_or_owner(v_existing.company_id) then
    raise exception 'No puedes cerrar la jornada de otra persona.';
  end if;

  -- No se re-cierra una jornada ya cerrada: eso pisaba
  -- correcciones que administracion ya habia validado.
  if v_existing.check_out_at is not null then
    raise exception 'Esa jornada ya estaba cerrada.';
  end if;

  update public.time_entries
  set
    check_out_at = now(),
    status = p_status::time_entry_status,
    workflow_status = p_workflow_status,
    flags = p_flags,
    check_out_geo_lat = p_check_out_geo_lat,
    check_out_geo_lng = p_check_out_geo_lng,
    check_out_geo_accuracy_m = p_check_out_geo_accuracy_m,
    check_out_geo_captured_at = p_check_out_geo_captured_at
  where id = p_entry_id
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_late_afternoon_checkin_incident(p_company_id uuid, p_user_id uuid, p_time_entry_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  )
  values (
    p_company_id,
    p_time_entry_id,
    'late_afternoon_checkin_incident',
    'pending',
    p_user_id,
    now()
  )
  on conflict do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_late_checkin_incident(p_company_id uuid, p_user_id uuid, p_time_entry_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  )
  values (
    p_company_id,
    p_time_entry_id,
    'late_checkin_incident',
    'pending',
    p_user_id,
    now()
  )
  on conflict do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_late_final_checkout_incident(p_company_id uuid, p_user_id uuid, p_time_entry_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  )
  values (
    p_company_id,
    p_time_entry_id,
    'late_final_checkout_incident',
    'pending',
    p_user_id,
    now()
  )
  on conflict do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_late_lunch_checkout_incident(p_company_id uuid, p_user_id uuid, p_time_entry_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  )
  values (
    p_company_id,
    p_time_entry_id,
    'late_lunch_checkout_incident',
    'pending',
    p_user_id,
    now()
  )
  on conflict do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_missing_afternoon_checkin_incident(p_company_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if exists (
    select 1
    from public.time_entry_requests r
    where r.company_id = p_company_id
      and r.requested_by = p_user_id
      and r.time_entry_id is null
      and r.reason = 'missing_afternoon_checkin_incident'
      and r.status = 'pending'
      and (r.requested_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
  ) then
    return;
  end if;

  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  ) values (
    p_company_id,
    null,
    'missing_afternoon_checkin_incident',
    'pending',
    p_user_id,
    now()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_missing_checkin_incident(p_company_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if exists (
    select 1
    from public.time_entry_requests r
    where r.company_id = p_company_id
      and r.requested_by = p_user_id
      and r.time_entry_id is null
      and r.reason = 'missing_checkin_incident'
      and r.status = 'pending'
      and (r.requested_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
  ) then
    return;
  end if;

  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  ) values (
    p_company_id,
    null,
    'missing_checkin_incident',
    'pending',
    p_user_id,
    now()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_missing_final_checkout_incident(p_company_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if exists (
    select 1
    from public.time_entry_requests r
    where r.company_id = p_company_id
      and r.requested_by = p_user_id
      and r.time_entry_id is null
      and r.reason = 'missing_final_checkout_incident'
      and r.status = 'pending'
      and (r.requested_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
  ) then
    return;
  end if;

  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  ) values (
    p_company_id,
    null,
    'missing_final_checkout_incident',
    'pending',
    p_user_id,
    now()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_missing_lunch_checkout_incident(p_company_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if exists (
    select 1
    from public.time_entry_requests r
    where r.company_id = p_company_id
      and r.requested_by = p_user_id
      and r.time_entry_id is null
      and r.reason = 'missing_lunch_checkout_incident'
      and r.status = 'pending'
      and (r.requested_at at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
  ) then
    return;
  end if;

  insert into public.time_entry_requests (
    company_id,
    time_entry_id,
    reason,
    status,
    requested_by,
    requested_at
  ) values (
    p_company_id,
    null,
    'missing_lunch_checkout_incident',
    'pending',
    p_user_id,
    now()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_final_checkout_reminders(p_company_id uuid)
 RETURNS TABLE(user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$
with ctx as (
  select
    (now() at time zone 'Europe/Madrid')::date as local_date,
    (now() at time zone 'Europe/Madrid')::time as local_time
),
calendar as (
  select
    c.company_id,
    c.day_end
  from public.company_work_calendar c
  where c.company_id = p_company_id
    and c.day_end is not null
),
afternoon_entry as (
  select
    t.user_id,
    t.company_id,
    t.id,
    t.check_out_at
  from public.time_entries t
  cross join ctx
  where t.company_id = p_company_id
    and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
    and (t.check_in_at at time zone 'Europe/Madrid')::time >= time '15:00'
),
base as (
  select
    a.user_id,
    a.company_id,
    ctx.local_date as reference_date,
    'final_checkout'::text as reference_slot,
    case
      when ctx.local_time >= (calendar.day_end + interval '30 minutes')::time
           and not public.push_already_sent(
             a.company_id,
             a.user_id,
             'missing_final_checkout_warning_2',
             ctx.local_date,
             'final_checkout'
           )
           and public.push_already_sent(
             a.company_id,
             a.user_id,
             'missing_final_checkout_warning_1',
             ctx.local_date,
             'final_checkout'
           )
        then 'missing_final_checkout_warning_2'

      when ctx.local_time >= (calendar.day_end + interval '15 minutes')::time
           and not public.push_already_sent(
             a.company_id,
             a.user_id,
             'missing_final_checkout_warning_1',
             ctx.local_date,
             'final_checkout'
           )
        then 'missing_final_checkout_warning_1'

      else null
    end as notification_type
  from afternoon_entry a
  cross join ctx
  join calendar on calendar.company_id = a.company_id
  where a.check_out_at is null
    and public.company_is_working_day(p_company_id, ctx.local_date) = true
    and public.worker_is_absent_on(p_company_id, a.user_id, ctx.local_date) = false
)
select
  user_id,
  company_id,
  reference_date,
  reference_slot,
  notification_type
from base
where notification_type is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.get_incident_candidates(p_company_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(user_id uuid, company_id uuid, incident_type text, time_entry_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with ctx as (
  select
    (p_now at time zone 'Europe/Madrid')::date as d,
    (p_now at time zone 'Europe/Madrid')::time as t
),
cal as (
  select c.morning_start, c.lunch_start, c.afternoon_start, c.day_end
  from public.company_work_calendar c
  where c.company_id = p_company_id
),
emp as (
  select m.user_id, m.company_id,
         coalesce(m.margen_tolerancia_minutos, 15) as tol
  from public.memberships m, ctx
  where m.company_id = p_company_id
    and m.role = 'employee'
    and m.status = 'active'
    and public.company_is_working_day(p_company_id, ctx.d) = true
    and public.worker_is_absent_on(p_company_id, m.user_id, ctx.d) = false
),
ent as (
  select
    t.id,
    t.user_id,
    (t.check_in_at  at time zone 'Europe/Madrid') as ci,
    (t.check_out_at at time zone 'Europe/Madrid') as co,
    row_number() over (partition by t.user_id order by t.check_in_at) as rn
  from public.time_entries t, ctx
  where t.company_id = p_company_id
    and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.d
),
manana as (select * from ent where rn = 1),
tarde  as (select * from ent where rn = 2)

-- No ha fichado la entrada
select e.user_id, e.company_id, 'missing_checkin'::text, null::uuid
from emp e, ctx, cal
where not exists (select 1 from ent where ent.user_id = e.user_id)
  and ctx.t >= (cal.morning_start + interval '30 minutes')::time

union all
-- Ha fichado la entrada tarde
select e.user_id, e.company_id, 'late_checkin', m.id
from emp e join manana m on m.user_id = e.user_id, ctx, cal
where m.ci::time > (cal.morning_start + (e.tol || ' minutes')::interval)::time
  and ctx.t >= (cal.morning_start + interval '30 minutes')::time

union all
-- No ha fichado la salida a comer
select e.user_id, e.company_id, 'missing_lunch_checkout', m.id
from emp e join manana m on m.user_id = e.user_id, ctx, cal
where m.co is null
  and ctx.t >= (cal.lunch_start + interval '30 minutes')::time
  and ctx.t <  cal.afternoon_start

union all
-- Ha fichado tarde la salida a comer
select e.user_id, e.company_id, 'late_lunch_checkout', m.id
from emp e join manana m on m.user_id = e.user_id, cal
where m.co is not null
  and m.co::time > (cal.lunch_start + (e.tol || ' minutes')::interval)::time
  and m.co::time <  cal.afternoon_start

union all
-- No ha vuelto de comer
select e.user_id, e.company_id, 'missing_afternoon_checkin', null::uuid
from emp e join manana m on m.user_id = e.user_id, ctx, cal
where m.co is not null
  and not exists (select 1 from tarde where tarde.user_id = e.user_id)
  and ctx.t >= (cal.afternoon_start + interval '30 minutes')::time

union all
-- Ha vuelto tarde de comer
select e.user_id, e.company_id, 'late_afternoon_checkin', a.id
from emp e join tarde a on a.user_id = e.user_id, cal
where a.ci::time > (cal.afternoon_start + (e.tol || ' minutes')::interval)::time

union all
-- No ha fichado la salida final
select e.user_id, e.company_id, 'missing_final_checkout', a.id
from emp e join tarde a on a.user_id = e.user_id, ctx, cal
where a.co is null
  and ctx.t >= (cal.day_end + interval '30 minutes')::time

union all
-- Ha fichado tarde la salida final
select e.user_id, e.company_id, 'late_final_checkout', a.id
from emp e join tarde a on a.user_id = e.user_id, cal
where a.co is not null
  and a.co::time > (cal.day_end + (e.tol || ' minutes')::interval)::time;
$function$
;

CREATE OR REPLACE FUNCTION public.get_long_open_shift_candidates(p_company_id uuid)
 RETURNS TABLE(time_entry_id uuid, user_id uuid, company_id uuid, check_in_at timestamp with time zone, hours_open numeric)
 LANGUAGE sql
AS $function$
  select
    t.id as time_entry_id,
    t.user_id,
    t.company_id,
    t.check_in_at,
    round(extract(epoch from (now() - t.check_in_at)) / 3600.0, 2) as hours_open
  from public.time_entries t
  where t.company_id = p_company_id
    and t.check_out_at is null
    and t.check_in_at <= now() - interval '10 hours'
    and public.company_is_working_day(p_company_id, (t.check_in_at at time zone 'UTC')::date) = true
    and public.worker_is_absent_on(p_company_id, t.user_id, current_date) = false;
$function$
;

CREATE OR REPLACE FUNCTION public.get_long_open_shift_notifications(p_company_id uuid)
 RETURNS TABLE(time_entry_id uuid, user_id uuid, company_id uuid, check_in_at timestamp with time zone, reference_date date, reference_slot text, notification_type text, hours_open numeric)
 LANGUAGE sql
AS $function$
  with candidates as (
    select
      t.id as time_entry_id,
      t.user_id,
      t.company_id,
      t.check_in_at,
      current_date as reference_date,
      'long_open_shift'::text as reference_slot,
      round(extract(epoch from (now() - t.check_in_at)) / 3600.0, 2) as hours_open
    from public.time_entries t
    where t.company_id = p_company_id
      and t.check_out_at is null
      and t.check_in_at <= now() - interval '10 hours'
      and public.company_is_working_day(p_company_id, current_date) = true
      and public.worker_is_absent_on(p_company_id, t.user_id, current_date) = false
  )
  select
    c.time_entry_id,
    c.user_id,
    c.company_id,
    c.check_in_at,
    c.reference_date,
    c.reference_slot,
    case
      when c.hours_open >= 10
        and c.hours_open < 10.5
        and not public.push_already_sent(
          c.company_id,
          c.user_id,
          'long_shift_warning_1',
          c.reference_date,
          c.reference_slot
        )
      then 'long_shift_warning_1'

      when c.hours_open >= 10.5
        and not public.push_already_sent(
          c.company_id,
          c.user_id,
          'long_shift_warning_2',
          c.reference_date,
          c.reference_slot
        )
      then 'long_shift_warning_2'

      else null
    end as notification_type,
    c.hours_open
  from candidates c
  where
    (
      c.hours_open >= 10
      and c.hours_open < 10.5
      and not public.push_already_sent(
        c.company_id,
        c.user_id,
        'long_shift_warning_1',
        c.reference_date,
        c.reference_slot
      )
    )
    or
    (
      c.hours_open >= 10.5
      and not public.push_already_sent(
        c.company_id,
        c.user_id,
        'long_shift_warning_2',
        c.reference_date,
        c.reference_slot
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_lunch_checkin_reminders(p_company_id uuid)
 RETURNS TABLE(user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$
with ctx as (
  select
    (now() at time zone 'Europe/Madrid')::date as local_date,
    (now() at time zone 'Europe/Madrid')::time as local_time
),
calendar as (
  select
    c.company_id,
    c.afternoon_start
  from public.company_work_calendar c
  where c.company_id = p_company_id
    and c.afternoon_start is not null
),
morning_entry as (
  select
    t.user_id,
    t.company_id,
    t.check_out_at
  from public.time_entries t
  cross join ctx
  where t.company_id = p_company_id
    and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
    and t.check_out_at is not null
),
afternoon_entry as (
  select distinct
    t.user_id,
    t.company_id
  from public.time_entries t
  cross join ctx
  where t.company_id = p_company_id
    and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
    and (t.check_in_at at time zone 'Europe/Madrid')::time >= time '15:00'
),
base as (
  select
    m.user_id,
    m.company_id,
    ctx.local_date as reference_date,
    'lunch_checkin'::text as reference_slot,
    case
      when ctx.local_time >= (calendar.afternoon_start + interval '30 minutes')::time
           and not public.push_already_sent(
             m.company_id,
             m.user_id,
             'missing_lunch_checkin_warning_2',
             ctx.local_date,
             'lunch_checkin'
           )
           and public.push_already_sent(
             m.company_id,
             m.user_id,
             'missing_lunch_checkin_warning_1',
             ctx.local_date,
             'lunch_checkin'
           )
        then 'missing_lunch_checkin_warning_2'

      when ctx.local_time >= (calendar.afternoon_start + interval '15 minutes')::time
           and not public.push_already_sent(
             m.company_id,
             m.user_id,
             'missing_lunch_checkin_warning_1',
             ctx.local_date,
             'lunch_checkin'
           )
        then 'missing_lunch_checkin_warning_1'

      else null
    end as notification_type
  from public.memberships m
  cross join ctx
  join calendar on calendar.company_id = m.company_id
  join morning_entry me
    on me.user_id = m.user_id
   and me.company_id = m.company_id
  left join afternoon_entry ae
    on ae.user_id = m.user_id
   and ae.company_id = m.company_id
  where m.company_id = p_company_id
    and m.role = 'employee'
    and public.company_is_working_day(p_company_id, ctx.local_date) = true
    and public.worker_is_absent_on(p_company_id, m.user_id, ctx.local_date) = false
    and ae.user_id is null
)
select
  user_id,
  company_id,
  reference_date,
  reference_slot,
  notification_type
from base
where notification_type is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.get_lunch_checkout_reminders(p_company_id uuid)
 RETURNS TABLE(user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$
with ctx as (
  select
    (now() at time zone 'Europe/Madrid')::date as local_date,
    (now() at time zone 'Europe/Madrid')::time as local_time
),
calendar as (
  select
    c.company_id,
    c.lunch_start
  from public.company_work_calendar c
  where c.company_id = p_company_id
    and c.lunch_start is not null
),
base as (
  select
    t.user_id,
    t.company_id,
    ctx.local_date as reference_date,
    'lunch_checkout'::text as reference_slot,
    case
      when ctx.local_time >= (calendar.lunch_start + interval '30 minutes')::time
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkout_warning_2',
             ctx.local_date,
             'lunch_checkout'
           )
           and public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkout_warning_1',
             ctx.local_date,
             'lunch_checkout'
           )
        then 'missing_lunch_checkout_warning_2'

      when ctx.local_time >= (calendar.lunch_start + interval '15 minutes')::time
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkout_warning_1',
             ctx.local_date,
             'lunch_checkout'
           )
        then 'missing_lunch_checkout_warning_1'

      else null
    end as notification_type
  from public.time_entries t
  cross join ctx
  join calendar on calendar.company_id = t.company_id
  where t.company_id = p_company_id
    and t.check_out_at is null
    and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
    and public.company_is_working_day(p_company_id, ctx.local_date) = true
    and public.worker_is_absent_on(p_company_id, t.user_id, ctx.local_date) = false
)
select
  user_id,
  company_id,
  reference_date,
  reference_slot,
  notification_type
from base
where notification_type is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.get_missing_checkin_incident_candidates(p_company_id uuid)
 RETURNS TABLE(user_id uuid, company_id uuid, reference_date date)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ctx as (
    select
      (now() at time zone 'Europe/Madrid')::date as local_date,
      (now() at time zone 'Europe/Madrid')::time as local_time
  )
  select
    m.user_id,
    m.company_id,
    ctx.local_date as reference_date
  from public.memberships m
  cross join ctx
  where m.company_id = p_company_id
    and m.role = 'employee'
    and m.status = 'active'
    and ctx.local_time >= time '09:00'
    and ctx.local_time <  time '10:00'
    and public.company_is_working_day(p_company_id, ctx.local_date) = true
    and public.worker_is_absent_on(p_company_id, m.user_id, ctx.local_date) = false
    and not exists (
      select 1
      from public.time_entries t
      where t.user_id = m.user_id
        and t.company_id = m.company_id
        and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_missing_checkin_notifications(p_company_id uuid)
 RETURNS TABLE(user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$with ctx as (
  select
    (now() at time zone 'Europe/Madrid')::date as local_date,
    (now() at time zone 'Europe/Madrid')::time as local_time
),
candidates as (
  select
    m.user_id,
    m.company_id,
    ctx.local_date as reference_date,
    case
      when ctx.local_time >= time '09:00'
           and ctx.local_time < time '09:15'
           and not public.push_already_sent(
             m.company_id,
             m.user_id,
             'missing_checkin_warning_2',
             ctx.local_date,
             'morning_checkin'
           )
           and public.push_already_sent(
             m.company_id,
             m.user_id,
             'missing_checkin_warning_1',
             ctx.local_date,
             'morning_checkin'
           )
        then 'missing_checkin_warning_2'

      when ctx.local_time >= time '08:45'
           and ctx.local_time < time '09:00'
           and not public.push_already_sent(
             m.company_id,
             m.user_id,
             'missing_checkin_warning_1',
             ctx.local_date,
             'morning_checkin'
           )
        then 'missing_checkin_warning_1'

      else null
    end as notification_type
  from public.memberships m
  cross join ctx
  where m.company_id = p_company_id
    and m.role = 'employee'
    and public.company_is_working_day(p_company_id, ctx.local_date) = true
    and public.worker_is_absent_on(p_company_id, m.user_id, ctx.local_date) = false
    and not exists (
      select 1
      from public.time_entries t
      where t.user_id = m.user_id
        and t.company_id = m.company_id
        and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
    )
)
select
  user_id,
  company_id,
  reference_date,
  'morning_checkin'::text as reference_slot,
  notification_type
from candidates
where notification_type is not null;$function$
;

CREATE OR REPLACE FUNCTION public.get_missing_final_checkout_notifications(p_company_id uuid)
 RETURNS TABLE(time_entry_id uuid, user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$with ctx as (
  select (now() at time zone 'Europe/Madrid')::time as local_time
),
candidates as (
  select
    t.id as time_entry_id,
    t.user_id,
    t.company_id,
    current_date as reference_date,
    'final_checkout'::text as reference_slot,
    case
      when ctx.local_time >= time '18:30'
           and ctx.local_time < time '18:45'
           and public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_final_checkout_warning_1',
             current_date,
             'final_checkout'
           )
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_final_checkout_warning_2',
             current_date,
             'final_checkout'
           )
        then 'missing_final_checkout_warning_2'

      when ctx.local_time >= time '18:15'
           and ctx.local_time < time '18:30'
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_final_checkout_warning_1',
             current_date,
             'final_checkout'
           )
        then 'missing_final_checkout_warning_1'

      else null
    end as notification_type
  from public.time_entries t
  cross join ctx
  where t.company_id = p_company_id
    and t.check_out_at is null
    and t.check_in_at::date = current_date
    and public.company_is_working_day(p_company_id, current_date) = true
    and public.worker_is_absent_on(p_company_id, t.user_id, current_date) = false
)
select
  time_entry_id,
  user_id,
  company_id,
  reference_date,
  reference_slot,
  notification_type
from candidates
where notification_type is not null;$function$
;

CREATE OR REPLACE FUNCTION public.get_missing_lunch_checkin_notifications(p_company_id uuid)
 RETURNS TABLE(time_entry_id uuid, user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$with ctx as (
  select (now() at time zone 'Europe/Madrid')::time as local_time
),
today_entries as (
  select
    t.*,
    row_number() over (
      partition by t.user_id
      order by t.check_in_at asc
    ) as rn,
    count(*) over (
      partition by t.user_id
    ) as day_entries
  from public.time_entries t
  where t.company_id = p_company_id
    and t.check_in_at::date = current_date
),
candidates as (
  select
    t.id as time_entry_id,
    t.user_id,
    t.company_id,
    current_date as reference_date,
    'lunch_checkin'::text as reference_slot,
    case
      when ctx.local_time >= time '16:00'
           and ctx.local_time < time '16:15'
           and public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkin_warning_1',
             current_date,
             'lunch_checkin'
           )
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkin_warning_2',
             current_date,
             'lunch_checkin'
           )
        then 'missing_lunch_checkin_warning_2'

      when ctx.local_time >= time '15:45'
           and ctx.local_time < time '16:00'
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkin_warning_1',
             current_date,
             'lunch_checkin'
           )
        then 'missing_lunch_checkin_warning_1'

      else null
    end as notification_type
  from today_entries t
  cross join ctx
  where t.rn = 1
    and t.check_out_at is not null
    and t.day_entries = 1
)
select
  time_entry_id,
  user_id,
  company_id,
  reference_date,
  reference_slot,
  notification_type
from candidates
where notification_type is not null;$function$
;

CREATE OR REPLACE FUNCTION public.get_missing_lunch_checkout_notifications(p_company_id uuid)
 RETURNS TABLE(time_entry_id uuid, user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$with ctx as (
  select (now() at time zone 'Europe/Madrid')::time as local_time
),
candidates as (
  select
    t.id as time_entry_id,
    t.user_id,
    t.company_id,
    current_date as reference_date,
    'lunch_checkout'::text as reference_slot,
    case
      when ctx.local_time >= time '14:30'
           and ctx.local_time < time '14:45'
           and public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkout_warning_1',
             current_date,
             'lunch_checkout'
           )
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkout_warning_2',
             current_date,
             'lunch_checkout'
           )
        then 'missing_lunch_checkout_warning_2'

      when ctx.local_time >= time '14:15'
           and ctx.local_time < time '14:30'
           and not public.push_already_sent(
             t.company_id,
             t.user_id,
             'missing_lunch_checkout_warning_1',
             current_date,
             'lunch_checkout'
           )
        then 'missing_lunch_checkout_warning_1'

      else null
    end as notification_type
  from public.time_entries t
  cross join ctx
  where t.company_id = p_company_id
    and t.check_out_at is null
    and t.check_in_at::date = current_date
    and public.company_is_working_day(p_company_id, current_date) = true
    and public.worker_is_absent_on(p_company_id, t.user_id, current_date) = false
)
select
  time_entry_id,
  user_id,
  company_id,
  reference_date,
  reference_slot,
  notification_type
from candidates
where notification_type is not null;$function$
;

CREATE OR REPLACE FUNCTION public.get_morning_checkin_reminders(p_company_id uuid)
 RETURNS TABLE(user_id uuid, company_id uuid, reference_date date, reference_slot text, notification_type text)
 LANGUAGE sql
AS $function$
with ctx as (
  select
    (now() at time zone 'Europe/Madrid')::date as local_date,
    (now() at time zone 'Europe/Madrid')::time as local_time
)
select
  m.user_id,
  m.company_id,
  ctx.local_date as reference_date,
  'morning_checkin'::text as reference_slot,
  case
    when ctx.local_time >= time '09:00'
         and not public.push_already_sent(
           m.company_id,
           m.user_id,
           'missing_checkin_warning_2',
           ctx.local_date,
           'morning_checkin'
         )
         and public.push_already_sent(
           m.company_id,
           m.user_id,
           'missing_checkin_warning_1',
           ctx.local_date,
           'morning_checkin'
         )
      then 'missing_checkin_warning_2'

    when ctx.local_time >= time '08:45'
         and not public.push_already_sent(
           m.company_id,
           m.user_id,
           'missing_checkin_warning_1',
           ctx.local_date,
           'morning_checkin'
         )
      then 'missing_checkin_warning_1'

    else null
  end as notification_type
from public.memberships m
cross join ctx
where m.company_id = p_company_id
  and m.role = 'employee'
  and public.company_is_working_day(p_company_id, ctx.local_date) = true
  and public.worker_is_absent_on(p_company_id, m.user_id, ctx.local_date) = false
  and not exists (
    select 1
    from public.time_entries t
    where t.user_id = m.user_id
      and t.company_id = m.company_id
      and (t.check_in_at at time zone 'Europe/Madrid')::date = ctx.local_date
  )
  and (
    (ctx.local_time >= time '08:45'
      and not public.push_already_sent(
        m.company_id,
        m.user_id,
        'missing_checkin_warning_1',
        ctx.local_date,
        'morning_checkin'
      ))
    or
    (ctx.local_time >= time '09:00'
      and public.push_already_sent(
        m.company_id,
        m.user_id,
        'missing_checkin_warning_1',
        ctx.local_date,
        'morning_checkin'
      )
      and not public.push_already_sent(
        m.company_id,
        m.user_id,
        'missing_checkin_warning_2',
        ctx.local_date,
        'morning_checkin'
      ))
  )
  and case
    when ctx.local_time >= time '09:00'
         and not public.push_already_sent(
           m.company_id,
           m.user_id,
           'missing_checkin_warning_2',
           ctx.local_date,
           'morning_checkin'
         )
         and public.push_already_sent(
           m.company_id,
           m.user_id,
           'missing_checkin_warning_1',
           ctx.local_date,
           'morning_checkin'
         )
      then 'missing_checkin_warning_2'
    when ctx.local_time >= time '08:45'
         and not public.push_already_sent(
           m.company_id,
           m.user_id,
           'missing_checkin_warning_1',
           ctx.local_date,
           'morning_checkin'
         )
      then 'missing_checkin_warning_1'
    else null
  end is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_company_hr_or_owner(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of_company(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.company_id = p_company_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_push_notification(p_company_id uuid, p_user_id uuid, p_notification_type text, p_reference_date date, p_reference_slot text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_id uuid;
begin
  select l.id
  into v_id
  from public.push_notification_log l
  where l.company_id = p_company_id
    and l.user_id = p_user_id
    and l.notification_type = p_notification_type
    and l.reference_date = p_reference_date
    and l.reference_slot = p_reference_slot
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.push_notification_log (
    company_id,
    user_id,
    notification_type,
    reference_date,
    reference_slot
  )
  values (
    p_company_id,
    p_user_id,
    p_notification_type,
    p_reference_date,
    p_reference_slot
  )
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_memberships()
 RETURNS TABLE(id uuid, company_id uuid, role membership_role, job_type text, horario_referencia text, margen_tolerancia_minutos integer, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, m.company_id, m.role, m.job_type, m.horario_referencia,
         m.margen_tolerancia_minutos, m.created_at
  from public.memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$function$
;

CREATE OR REPLACE FUNCTION public.proteger_hora_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or is_company_hr_or_owner(new.company_id) then
    return new;
  end if;
  new.check_in_at := old.check_in_at;
  new.user_id     := old.user_id;
  new.company_id  := old.company_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.push_already_sent(p_company_id uuid, p_user_id uuid, p_notification_type text, p_reference_date date, p_reference_slot text)
 RETURNS boolean
 LANGUAGE sql
AS $function$
  select exists (
    select 1
    from public.push_notification_log l
    where l.company_id = p_company_id
      and l.user_id = p_user_id
      and l.notification_type = p_notification_type
      and l.reference_date = p_reference_date
      and l.reference_slot = p_reference_slot
  );
$function$
;

CREATE OR REPLACE FUNCTION public.request_time_entry_adjustment(p_time_entry_id uuid, p_proposed_check_out timestamp with time zone, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_original_check_out timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason required';
  end if;

  select te.check_out_at
    into v_original_check_out
  from public.time_entries te
  where te.id = p_time_entry_id
    and te.user_id = v_user_id;

  if not found then
    raise exception 'time entry not found or not owned';
  end if;

  insert into public.time_entry_adjustments (
    time_entry_id,
    original_check_out,
    proposed_check_out,
    final_check_out,
    status,
    created_by,
    resolved_by,
    reason
  ) values (
    p_time_entry_id,
    v_original_check_out,
    p_proposed_check_out,
    null,
    'pending',
    v_user_id,
    null,
    trim(p_reason)
  );

  update public.time_entries
  set
    workflow_status = 'pending',
    flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{cierre_manual}', 'true'::jsonb, true)
  where id = p_time_entry_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_time_entry_adjustment(p_adjustment_id uuid, p_decision text, p_resolution_reason text, p_final_check_out timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_time_entry_id uuid;
  v_proposed_check_out timestamptz;
  v_old_check_out timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_decision not in ('validated','rejected') then
    raise exception 'invalid decision';
  end if;

  if p_resolution_reason is null or length(trim(p_resolution_reason)) < 3 then
    raise exception 'resolution reason required';
  end if;

  select
    te.company_id,
    te.id,
    a.proposed_check_out,
    te.check_out_at
  into
    v_company_id,
    v_time_entry_id,
    v_proposed_check_out,
    v_old_check_out
  from public.time_entry_adjustments a
  join public.time_entries te on te.id = a.time_entry_id
  where a.id = p_adjustment_id
    and a.status = 'pending';

  if not found then
    raise exception 'adjustment not found or not pending';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.company_id = v_company_id
      and m.user_id = v_user_id
      and m.role in ('admin','owner')
  ) then
    raise exception 'forbidden';
  end if;

  update public.time_entry_adjustments
  set
    status = p_decision,
    resolved_by = v_user_id,
    resolved_at = now(),
    final_check_out = case
      when p_decision = 'validated'
      then coalesce(p_final_check_out, v_proposed_check_out)
      else null
    end,
    reason = reason || ' | RESOLUCIÓN: ' || trim(p_resolution_reason)
  where id = p_adjustment_id;

  if p_decision = 'validated' then

    update public.time_entries
    set
      check_out_at = coalesce(p_final_check_out, v_proposed_check_out),
      workflow_status = 'adjusted',
      flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object(
        'admin_resolution_decision', 'validated',
        'admin_resolution_reason', trim(p_resolution_reason),
        'admin_resolution_at', now(),
        'admin_old_check_out_at', v_old_check_out,
        'admin_new_check_out_at', coalesce(p_final_check_out, v_proposed_check_out)
      )
    where id = v_time_entry_id;

    insert into public.time_entry_logs (
      company_id,
      time_entry_id,
      action,
      performed_by,
      performed_role,
      old_values,
      new_values
    ) values (
      v_company_id,
      v_time_entry_id,
      'adjustment_validated',
      v_user_id,
      'admin',
      jsonb_build_object(
        'check_out_at', v_old_check_out,
        'workflow_status', 'pending'
      ),
      jsonb_build_object(
        'check_out_at', coalesce(p_final_check_out, v_proposed_check_out),
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
      company_id,
      time_entry_id,
      action,
      performed_by,
      performed_role,
      old_values,
      new_values
    ) values (
      v_company_id,
      v_time_entry_id,
      'adjustment_rejected',
      v_user_id,
      'admin',
      jsonb_build_object(
        'workflow_status', 'pending'
      ),
      jsonb_build_object(
        'workflow_status', 'rejected',
        'resolution_reason', trim(p_resolution_reason)
      )
    );

  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_time_entry_request(p_request_id uuid, p_decision text, p_resolution_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_decision not in ('validated','rejected') then
    raise exception 'invalid decision';
  end if;

  if p_resolution_reason is null or length(trim(p_resolution_reason)) < 3 then
    raise exception 'resolution reason required';
  end if;

  select company_id
  into v_company_id
  from public.time_entry_requests
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'request not found or already resolved';
  end if;

  if not exists (
    select 1
    from public.memberships
    where company_id = v_company_id
      and user_id = v_user_id
      and role in ('admin','owner')
  ) then
    raise exception 'forbidden';
  end if;

  update public.time_entry_requests
  set
    status = (
      case
        when p_decision = 'validated' then 'approved'
        else 'rejected'
      end
    )::public.time_request_status,
    resolved_by = v_user_id,
    resolved_at = now()
  where id = p_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.worker_is_absent_on(p_company_id uuid, p_user_id uuid, p_target_date date)
 RETURNS boolean
 LANGUAGE sql
AS $function$
  select exists (
    select 1
    from public.worker_absences a
    where a.company_id = p_company_id
      and a.user_id = p_user_id
      and p_target_date between a.start_date and a.end_date
  );
$function$
  
