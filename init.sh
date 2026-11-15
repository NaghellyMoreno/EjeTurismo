#!/usr/bin/env bash
# init.sh — instala, verifica el contrato, levanta la base local y corre la prueba de humo.
# Se puede ejecutar varias veces seguidas. Nunca imprime secretos ni deja procesos en segundo plano.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "AVISO: no hay .env (cópialo desde .env.example). La prueba de humo no lo necesita; la app y el bot sí."
fi

echo "== Dependencias"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "== Contrato"
pnpm api:check

echo "== Base de datos"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  pnpm db:start
  pnpm db:reset
else
  echo "AVISO: Docker no está disponible; se omite la base local (db:start y db:reset). Instálalo y ábrelo para trabajar con la base." >&2
fi

echo "== Tipos y prueba de humo"
pnpm typecheck
pnpm test:smoke

echo "Listo. Para desarrollar: pnpm dev (http://localhost:${PORT:-3000}, salud en /api/health)"
