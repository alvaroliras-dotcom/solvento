-- =====================================================================
-- Cerbero · 3 de octubre de 2026 · Registro de altas y bajas
--
-- Administracion ya puede dar de alta, dar de baja, reactivar y cambiar el
-- PIN de un trabajador desde el panel (Edge Function admin_manage_employee).
-- Cada una de esas acciones queda apuntada aqui: quien, a quien, cuando y
-- con que motivo. Solo la escribe el servidor; administracion la puede leer.
-- =====================================================================
create table if not exists public.employee_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  action text not null check (action in ('alta', 'baja', 'reactivacion', 'cambio_pin')),
  performed_by uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists employee_changes_company_idx
  on public.employee_changes (company_id, created_at desc);

alter table public.employee_changes enable row level security;

drop policy if exists employee_changes_select_admin on public.employee_changes;
create policy employee_changes_select_admin on public.employee_changes
  for select to authenticated
  using (public.is_company_hr_or_owner(company_id));

revoke all on public.employee_changes from anon;
grant select on public.employee_changes to authenticated;
