-- Solo local (ADR 0014, D-063). Lo ejecuta el superusuario del clúster de Homebrew.
-- Idempotente: crea cada rol solo si no existe. No crea eje_app (lo crea la migración, ADR 0006).
-- Sin contraseñas.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres login createdb createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;
