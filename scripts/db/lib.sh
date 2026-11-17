#!/usr/bin/env bash
# Funciones comunes de los scripts db:* (ADR 0014, D-063). Se usa con `source`.
# Solo local: usa PostgreSQL 17 de Homebrew. Nunca imprime URLs con secretos ni inicia/detiene el servicio.

DB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Carga .env si existe (en la máquina de quien ejecuta), sin pisar variables ya definidas.
if [ -f "$DB_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$DB_ROOT/.env"
  set +a
fi

# Base propia por worktree: si LOCAL_DB_NAME no está definida y esto es un worktree de git (no el checkout principal),
# se deriva de la carpeta (eje_turismo_dev_<carpeta>). En el checkout principal sigue siendo eje_turismo_dev.
if [ -z "${LOCAL_DB_NAME:-}" ]; then
  LOCAL_DB_NAME="eje_turismo_dev"
  if [ "$(git -C "$DB_ROOT" rev-parse --git-dir 2>/dev/null)" != "$(git -C "$DB_ROOT" rev-parse --git-common-dir 2>/dev/null)" ]; then
    suffix="$(basename "$DB_ROOT" | tr 'A-Z-' 'a-z_' | tr -cd 'a-z0-9_' | cut -c1-40)"
    [ -n "$suffix" ] && LOCAL_DB_NAME="eje_turismo_dev_${suffix}"
  fi
fi
LOCAL_PG_SUPERUSER_URL="${LOCAL_PG_SUPERUSER_URL:-postgresql://localhost:5432/postgres}"
LOCAL_DATABASE_MIGRATIONS_URL="${LOCAL_DATABASE_MIGRATIONS_URL:-postgresql://postgres@localhost:5432/${LOCAL_DB_NAME}}"

die() { echo "ERROR: $*" >&2; exit 1; }

# Encuentra los binarios de PostgreSQL: PG_BIN o la carpeta de la fórmula postgresql@17.
resolve_pg_bin() {
  if [ -z "${PG_BIN:-}" ]; then
    if command -v brew >/dev/null 2>&1; then
      PG_BIN="$(brew --prefix postgresql@17 2>/dev/null)/bin"
    else
      PG_BIN=""
    fi
  fi
  if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/psql" ] || [ ! -x "$PG_BIN/pg_isready" ]; then
    echo "ERROR: no se encontró PostgreSQL 17 de Homebrew. Instálalo con: brew install postgresql@17" >&2
    echo "       Luego levántalo con: brew services start postgresql@17 (o define PG_BIN con la carpeta de sus binarios)." >&2
    return 2
  fi
  export PG_BIN
}

# Comprueba que el servidor responde en la URL dada.
require_server() {
  local url="$1"
  "$PG_BIN/pg_isready" -q -d "$url" || {
    echo "ERROR: el servidor PostgreSQL local no responde. Levántalo con: brew services start postgresql@17" >&2
    return 3
  }
}

# Host de una URL postgresql://[usuario@]host[:puerto]/base
url_host() {
  local rest="${1#*://}"
  rest="${rest#*@}"
  rest="${rest%%/*}"
  case "$rest" in
    \[*\]*) rest="${rest%%]*}"; echo "${rest#\[}" ;;
    *) echo "${rest%%:*}" ;;
  esac
}

require_local_url() {
  case "$(url_host "$1")" in
    localhost|127.0.0.1|::1) ;;
    *) die "se niega a actuar sobre un host que no es local (localhost, 127.0.0.1 o ::1)." ;;
  esac
}

# URL de la base `$2` con las credenciales y el servidor de la URL `$1` (sin parámetros de consulta).
url_for_db() { echo "${1%/*}/$2"; }

require_db_name() {
  [[ "$1" =~ ^[a-z0-9_]+$ ]] || die "nombre de base no válido: use solo minúsculas, números y guion bajo."
}

psql_run() { "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

# Borra una base sin `with (force)` (exige superusuario): cierra las sesiones de cliente y reintenta. $1 = URL de administración, $2 = base.
drop_database() {
  local admin_url="$1" name="$2" attempt
  for attempt in 1 2 3 4 5; do
    psql_run -d "$admin_url" -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$name' and backend_type = 'client backend' and pid <> pg_backend_pid()" >/dev/null
    if psql_run -d "$admin_url" -c "drop database if exists \"$name\"" 2>/dev/null; then return 0; fi
    sleep 0.2
  done
  psql_run -d "$admin_url" -c "drop database if exists \"$name\""
}
