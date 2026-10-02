-- =====================================================================
-- Cerbero · 2 de octubre de 2026 · Incidencias sin duplicar
--
-- La tarea automatica solo miraba si ya habia una incidencia PENDIENTE de
-- ese dia. Al resolverla administracion, el siguiente cuarto de hora creaba
-- otra igual (habia 42 grupos duplicados). Ahora no repite si ya existe una
-- de ese dia, este como este.
-- =====================================================================
do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid, p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_missing_checkin_incident', 'create_missing_lunch_checkout_incident',
                        'create_missing_afternoon_checkin_incident', 'create_missing_final_checkout_incident')
  loop
    v_def := pg_get_functiondef(f.oid);
    if v_def ~ 'and r\.status = ''pending''' then
      v_def := regexp_replace(v_def, '\s*and r\.status = ''pending''', '', 'g');
      execute v_def;
    end if;
  end loop;
end $$;
