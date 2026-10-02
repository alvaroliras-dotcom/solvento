-- =====================================================================
-- Cerbero · 2 de octubre de 2026 · Tarea automatica protegida
--
-- La tarea que crea incidencias y manda avisos (run_long_open_shift_checks)
-- se podia lanzar con la clave publica de la app. Ahora exige una
-- contraseña interna que solo conoce el programador de tareas (cron).
--
-- Los dos secretos viven en el almacen de secretos de Supabase (Vault):
--   cerbero_cron_secret       contraseña aleatoria que comprueba la funcion
--   cerbero_cron_gateway_jwt  clave con la que el cron pasa la puerta de las
--                             Edge Functions (la misma que usaba antes, que
--                             estaba escrita a la vista en la orden del cron)
-- Ninguno se guarda en este repositorio.
-- =====================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cerbero_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'cerbero_cron_secret',
      'Contraseña con la que el cron llama a run_long_open_shift_checks');
  end if;
end $$;

-- (cerbero_cron_gateway_jwt se creo a mano con la clave que ya usaba el
-- cron; para recrearlo en otro proyecto:
--   select vault.create_secret('<clave anon del proyecto>', 'cerbero_cron_gateway_jwt');)

create or replace function public.cron_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_secret, '') <> ''
     and p_secret = (select decrypted_secret from vault.decrypted_secrets
                     where name = 'cerbero_cron_secret' limit 1);
$$;

revoke execute on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'cerbero_long_open_shift_every_15m'),
  command := $cmd$
  select net.http_post(
    url := 'https://dooldjcaasfrmtozcyyq.supabase.co/functions/v1/run_long_open_shift_checks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cerbero_cron_gateway_jwt' limit 1),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cerbero_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cmd$
);
