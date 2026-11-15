#!/usr/bin/env bash
# db:seed [base] — carga reference.sql y después demo.sql (solo en la base de desarrollo local).
# Con SEED_DEMO=0 omite demo.sql (bases de pruebas).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
db="${1:-$LOCAL_DB_NAME}"
require_db_name "$db"
resolve_pg_bin
require_local_url "$LOCAL_DATABASE_MIGRATIONS_URL"
url="$(url_for_db "$LOCAL_DATABASE_MIGRATIONS_URL" "$db")"
require_server "$url"

psql_run --single-transaction -d "$url" -f "$DB_ROOT/supabase/seed/reference.sql"
if [ "${SEED_DEMO:-1}" != "0" ]; then
  psql_run --single-transaction -d "$url" -f "$DB_ROOT/supabase/seed/demo.sql"
fi
echo "Semillas cargadas en $db."
