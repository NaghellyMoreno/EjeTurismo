#!/usr/bin/env bash
# db:bootstrap — comprueba servidor, versión y extensiones, y aplica supabase/local/bootstrap.sql (idempotente).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
resolve_pg_bin
require_local_url "$LOCAL_PG_SUPERUSER_URL"
require_server "$LOCAL_PG_SUPERUSER_URL"

version="$(psql_run -tA -d "$LOCAL_PG_SUPERUSER_URL" -c "show server_version_num")"
[ "${version:0:2}" = "17" ] || die "se requiere PostgreSQL 17 y el servidor es la versión $version. Usa: brew install postgresql@17"

for ext in btree_gist unaccent; do
  found="$(psql_run -tA -d "$LOCAL_PG_SUPERUSER_URL" -c "select 1 from pg_available_extensions where name = '$ext'")"
  [ "$found" = "1" ] || die "falta la extensión $ext (paquete contrib de postgresql@17)."
done

psql_run -d "$LOCAL_PG_SUPERUSER_URL" -f "$DB_ROOT/supabase/local/bootstrap.sql"
echo "Bootstrap local aplicado."
