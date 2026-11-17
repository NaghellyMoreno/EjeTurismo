#!/usr/bin/env bash
# db:test:clean — borra bases eje_turismo_test_* y eje_turismo_e2e_* con más de una hora.
# La marca de tiempo del nombre (AAAAMMDDhhmmss) se interpreta en UTC.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
resolve_pg_bin
require_local_url "$LOCAL_DATABASE_MIGRATIONS_URL"
admin_url="$(url_for_db "$LOCAL_DATABASE_MIGRATIONS_URL" postgres)"
require_server "$admin_url"

cutoff="$(date -u -v-1H +%Y%m%d%H%M%S 2>/dev/null || date -u -d '1 hour ago' +%Y%m%d%H%M%S)"
removed=0
while IFS= read -r name; do
  [[ "$name" =~ ^eje_turismo_(test|e2e)_([0-9]{14})_[a-z0-9]+$ ]] || continue
  stamp="${BASH_REMATCH[2]}"
  if [ "$stamp" -lt "$cutoff" ]; then
    drop_database "$admin_url" "$name"
    echo "Borrada: $name"
    removed=$((removed + 1))
  fi
done < <(psql_run -tA -d "$admin_url" -c "select datname from pg_database where datname ~ '^eje_turismo_(test|e2e)_'")
echo "Bases temporales borradas: $removed."
