-- =====================================================================
-- Cerbero · 2 de octubre de 2026 · Marcas de ubicacion para el panel
--
-- El panel de administracion lee check_in_geo_* / check_out_geo_*. Antes
-- las escribia el movil con su propia geovalla (coordenadas escritas a mano
-- en el codigo); ahora las escribe el servidor a partir de geo_verdict, que
-- usa la geovalla de la empresa (company_geofence).
-- =====================================================================
create or replace function public.marcas_geo_panel(p_prefijo text, p_geo jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    p_prefijo || '_geo_can_evaluate_workplace', coalesce((p_geo->>'servidor_evaluado')::boolean, false),
    p_prefijo || '_geo_distance_to_workplace_m', p_geo->'servidor_distancia_m',
    p_prefijo || '_geo_outside_workplace',
      case when coalesce((p_geo->>'servidor_evaluado')::boolean, false)
           then p_geo->'servidor_fuera' else 'null'::jsonb end,
    p_prefijo || '_geo_reason',
      case p_geo->>'servidor_motivo'
        when 'dentro_del_centro_de_trabajo' then 'inside_workplace_radius'
        when 'fuera_del_centro_de_trabajo' then 'outside_workplace_radius'
        when 'precision_insuficiente' then 'low_accuracy'
        when 'sin_geolocalizacion' then 'no_geolocation'
        else coalesce(p_geo->>'servidor_motivo', 'no_geolocation')
      end
  );
$$;

revoke execute on function public.marcas_geo_panel(text, jsonb) from public, anon, authenticated;

-- Se anade al final de las marcas que calculan las dos funciones de fichar
-- (definidas en 20261002120000_cerrar_accesos.sql).
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.create_checkin_server_time'::regproc);
  if v_def !~ 'marcas_geo_panel' then
    v_def := replace(v_def,
      '|| jsonb_build_object(''servidor_tramos_hoy_previos'', v_tramos_hoy);',
      '|| jsonb_build_object(''servidor_tramos_hoy_previos'', v_tramos_hoy)
    || public.marcas_geo_panel(''check_in'', v_geo);');
    if v_def !~ 'marcas_geo_panel' then raise exception 'patron entrada no encontrado'; end if;
    execute v_def;
  end if;

  v_def := pg_get_functiondef('public.create_checkout_server_time'::regproc);
  if v_def !~ 'marcas_geo_panel' then
    v_def := replace(v_def,
      '|| jsonb_build_object(''servidor_horas_tramo'', v_horas, ''servidor_cruza_dia'', v_cruza_dia);',
      '|| jsonb_build_object(''servidor_horas_tramo'', v_horas, ''servidor_cruza_dia'', v_cruza_dia)
    || public.marcas_geo_panel(''check_out'', v_geo);');
    if v_def !~ 'marcas_geo_panel' then raise exception 'patron salida no encontrado'; end if;
    execute v_def;
  end if;
end $$;
