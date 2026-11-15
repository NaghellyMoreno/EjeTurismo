#!/usr/bin/env bash
# db:reset — bootstrap, recrea la base de desarrollo, migra y carga semillas. Solo hosts locales.
set -euo pipefail
here="$(dirname "$0")"
source "$here/lib.sh"
require_db_name "$LOCAL_DB_NAME"
resolve_pg_bin
require_local_url "$LOCAL_DATABASE_MIGRATIONS_URL"
admin_url="$(url_for_db "$LOCAL_DATABASE_MIGRATIONS_URL" postgres)"

"$here/bootstrap.sh"
psql_run -d "$admin_url" -c "drop database if exists \"$LOCAL_DB_NAME\" with (force)"
"$here/migrate.sh" "$LOCAL_DB_NAME"
"$here/seed.sh" "$LOCAL_DB_NAME"
echo "Base $LOCAL_DB_NAME recreada."
