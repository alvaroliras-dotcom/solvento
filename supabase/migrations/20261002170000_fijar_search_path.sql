-- =====================================================================
-- Cerbero · 2 de octubre de 2026 · Fijar search_path
-- Buenas practicas (aviso del revisor de seguridad de Supabase): fijar el
-- search_path de las funciones que no lo tenian.
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;
