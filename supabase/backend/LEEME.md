# Motor de Cerbero (copia de seguridad)

Todo lo que hace funcionar Cerbero por dentro vive dentro de Supabase, no en
este repositorio. Estos archivos son la copia de seguridad de esa parte, para
que si algun dia se pierde el proyecto de Supabase se pueda reconstruir.

Fecha de la copia: 8 de septiembre de 2026.

## Que hay aqui

- `funciones.sql` — las 40 funciones de base de datos, tal cual estan
  publicadas. Se ejecutan con permisos de administrador (security definer),
  asi que son ellas las que deciden quien puede hacer que.
- `permisos.sql` — las politicas de seguridad por fila (RLS) de todas las
  tablas: quien puede leer y escribir cada cosa.

La tarea automatica que genera las incidencias esta en
`supabase/functions/run_long_open_shift_checks/index.ts`, y esa copia si es
la que corre de verdad.

## La tarea programada

Se llama `cerbero_long_open_shift_every_15m` y se ejecuta cada quince minutos
(`*/15 * * * *`, en hora universal). Llama a la funcion de arriba, que a su
vez pregunta a `get_incident_candidates` que incidencias tocan y manda los
avisos al movil.

## Como volver a generar esta copia

En el editor SQL de Supabase:

```sql
-- funciones.sql
select string_agg(pg_get_functiondef(oid), ';' || chr(10) || chr(10) order by proname)
from pg_proc
where pronamespace = 'public'::regnamespace and prokind = 'f';
```

Y para los permisos, la consulta que arma las politicas desde `pg_policies`.

## Aviso importante

Si alguien vuelve a publicar la tarea automatica desde este repositorio, que
compruebe antes que la copia de aqui esta al dia. En agosto de 2026 la copia
que habia era antigua y apuntaba a una empresa que ya no existe: publicarla
habria dejado sin incidencias a toda la plantilla.
