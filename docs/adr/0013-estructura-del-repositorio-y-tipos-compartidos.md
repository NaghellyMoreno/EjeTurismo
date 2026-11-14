# 0013. Estructura del repositorio y tipos compartidos generados desde `api/openapi.yaml`

- **Estado:** Propuesta
- **Fecha:** 2026-11-14
- **Fuente:** CLAUDE.md (Mapa del repositorio, Convenciones); sección 3.13 (trazabilidad); ADR 0001

## Contexto
`api/openapi.yaml` es el contrato entre la Mini App y el backend. El bot llama a los servicios dentro del proceso. Si los tipos se escriben a mano en ambos lados, divergen del contrato.

## Decisión
**Un solo paquete** (sin monorepo de varios paquetes) con esta estructura:
```
api/openapi.yaml                 contrato (lo escribe el architect)
src/app/                         Next.js App Router
  (miniapp)/                     pantallas de la Mini App
  api/v1/**/route.ts             adaptador HTTP: valida, construye Actor, llama al servicio, mapea errores
  api/v1/telegram/webhook/route.ts
  api/v1/internal/cron/*/route.ts
src/bot/                         adaptador grammY: menús, formularios, textos en español
src/server/
  config/                        variables de entorno validadas
  auth/                          initData, actor, roles
  services/                      casos de uso: única puerta a datos y reglas
  domain/                        reglas puras (transiciones, validaciones, normalización)
  db/                            Kysely, tipos generados de la base, transacciones
  storage/                       puerto de fotos (Vercel Blob) y simulador en memoria
  notifications/                 bandeja de salida y envío por Telegram
  jobs/                          tareas diarias y eliminación de datos
  observability/                 logger con redacción
src/shared/api/schema.d.ts       GENERADO desde api/openapi.yaml (no se edita)
src/shared/api/client.ts         cliente openapi-fetch de la Mini App (añade Authorization: tma ...)
src/miniapp/                     componentes de la Mini App
supabase/config.toml, migrations/, seed/
scripts/                         set-webhook, bot-dev, notice-publish, purge-dry-run
tests/unit, tests/integration, tests/bot, tests/e2e, tests/factories
vercel.json, .env.example, init.sh
```

**Tipos compartidos.**
- `pnpm api:types` ejecuta `openapi-typescript api/openapi.yaml -o src/shared/api/schema.d.ts` (openapi-typescript 7.x, verificado 7.13.0).
- La Mini App usa `openapi-fetch` (verificado 0.17.0) con esos tipos: rutas, parámetros y respuestas tipados.
- Los route handlers tipan sus respuestas con los tipos generados (`components['schemas'][...]`); los esquemas Zod de entrada se escriben a mano y una prueba de contrato compara ejemplos válidos e inválidos contra `api/openapi.yaml`.
- `pnpm api:lint` (`@redocly/cli lint`, verificado 2.78.0) valida el contrato.
- La comprobación `pnpm api:check` falla si `schema.d.ts` no coincide con el contrato (se regenera y se compara en CI o en `init.sh`).
- Tipos de la base: `kysely-codegen` (verificado 0.20.0) genera `src/server/db/types.ts` desde la base local después de migrar.

**Fronteras.** ESLint con `no-restricted-imports`: `src/app/**` y `src/bot/**` no importan `src/server/db/**` ni `src/server/storage/**` (ADR 0001); `src/miniapp/**` no importa nada de `src/server/**`.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Monorepo con paquetes `web`, `bot` y `core` | Fronteras físicas | Más configuración (workspaces, compilación) para un proyecto individual de 12 días |
| Generar el contrato desde el código (Zod a OpenAPI) | Una sola fuente | El contrato lo escribe el architect antes del código (Spec-Driven Development, sección 3.13) |
| tRPC | Tipos de extremo a extremo | No produce un contrato OpenAPI, que es entregable |

## Consecuencias
- Más fácil: un cambio de contrato rompe la compilación de la Mini App donde corresponde.
- Más difícil: los esquemas Zod pueden divergir del contrato; lo detectan las pruebas de contrato.
