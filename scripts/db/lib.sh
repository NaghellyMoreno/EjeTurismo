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

LOCAL_DB_NAME="${LOCAL_DB_NAME:-eje_turismo_dev}"
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
