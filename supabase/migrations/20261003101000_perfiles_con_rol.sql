-- =====================================================================
-- Cerbero · 3 de octubre de 2026 · admin_company_profiles_all con rol
-- La pantalla de Empleados necesita saber el rol (solo se gestionan altas
-- y bajas de trabajadores) y el motivo de la baja. Se anaden dos columnas;
-- quien ya la usaba sigue funcionando igual.
-- =====================================================================
drop function if exists public.admin_company_profiles_all(uuid);

create function public.admin_company_profiles_all(p_company_id uuid)
returns table(id uuid, email text, full_name text, status text, ended_at timestamptz, role text, end_reason text)
language sql
security definer
set search_path = public
as $$
  select p.id as id, p.email, p.full_name, m.status, m.ended_at, m.role::text, m.end_reason
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
    and public.is_company_hr_or_owner(p_company_id)
  order by lower(coalesce(p.full_name, p.email, p.id::text));
$$;

revoke execute on function public.admin_company_profiles_all(uuid) from public, anon;
grant execute on function public.admin_company_profiles_all(uuid) to authenticated, service_role;
