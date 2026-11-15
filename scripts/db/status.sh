#!/usr/bin/env bash
# Sale con 0 si PostgreSQL 17 local está instalado y responde; con 2 o 3 y un mensaje claro si no.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
resolve_pg_bin
require_server "$LOCAL_PG_SUPERUSER_URL"
