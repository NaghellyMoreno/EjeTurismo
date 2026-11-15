#!/usr/bin/env bash
# db:migrate [base] — crea la base si no existe y aplica las migraciones que falten.
# Historial en supabase_migrations.schema_migrations, igual que la CLI de Supabase.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
db="${1:-$LOCAL_DB_NAME}"
require_db_name "$db"
resolve_pg_bin
require_local_url "$LOCAL_DATABASE_MIGRATIONS_URL"
admin_url="$(url_for_db "$LOCAL_DATABASE_MIGRATIONS_URL" postgres)"
url="$(url_for_db "$LOCAL_DATABASE_MIGRATIONS_URL" "$db")"
require_server "$admin_url"

exists="$(psql_run -tA -d "$admin_url" -c "select 1 from pg_database where datname = '$db'")"
if [ "$exists" != "1" ]; then
  psql_run -d "$admin_url" -c "create database \"$db\""
fi

psql_run -d "$url" -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])"

applied=0
shopt -s nullglob
for file in "$DB_ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$file" .sql)"
  [[ "$base" =~ ^[0-9]+_[a-z0-9_]+$ ]] || die "nombre de migración no válido: $base.sql (use <marca>_<nombre>.sql en minúsculas)."
  version="${base%%_*}"
  name="${base#*_}"
  done_already="$(psql_run -tA -d "$url" -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")"
  [ "$done_already" = "1" ] && continue
  psql_run --single-transaction -d "$url" -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name, statements) values ('$version', '$name', '{}')"
  echo "Migración aplicada: $base"
  applied=$((applied + 1))
done
echo "Migraciones en $db: $applied nueva(s)."
