# 0014. Herramientas: pnpm, migraciones SQL con la CLI de Supabase, Kysely, Vitest y Playwright

- **Estado:** Propuesta
- **Fecha:** 2026-11-14
- **Fuente:** sección 3.13 (pruebas y evidencias como entregables); CLAUDE.md (Stack); guía de agentes (developer, qa-evaluator)

## Contexto
Se necesitan herramientas para instalar, migrar, consultar la base, probar backend, bot, Mini App y extremo a extremo, y guardar evidencias de pruebas (entregable). Las restricciones de la base (exclusión, disparadores, RLS, roles) se escriben mejor en SQL. Versiones verificadas en el registro de npm y en la documentación oficial el 2026-11-14.

## Decisión
| Para qué | Herramienta | Versión fijada | Nota |
| --- | --- | --- | --- |
| Entorno de ejecución | Node.js | 24.x (`engines.node`) | Soportada por Vercel (22.x, 24.x y 26.x disponibles) |
| Gestor de paquetes | pnpm | 10.x (`packageManager` con Corepack) | Vercel soporta pnpm 6 a 12; 10 usa `lockfileVersion: 9.0` |
| Framework | Next.js | 16.x (verificado 16.4.6) | App Router, route handlers, `after()` |
| Bot | grammY | 1.x (verificado 1.46.0) | Sesión propia con almacenamiento en PostgreSQL (ADR 0015) |
| Validación | Zod | 4.x (verificado 4.6.7) | Entrada de API y pasos del bot |
| Acceso a la base | Kysely + `pg` | Kysely 0.29.x (verificado 0.29.9), `pg` 8.x (verificado 8.23.1) | SQL tipado, transacciones, `FOR UPDATE`; sin sentencias preparadas con nombre (pooler en modo transacción) |
| Tipos de la base | kysely-codegen | 0.20.x | Desde la base local migrada |
| Migraciones y base local | CLI de Supabase | 3.x (verificado 3.1.0, paquete `supabase` como dependencia de desarrollo) | `supabase migration new`, `supabase db reset`, `supabase db push`; requiere Docker en local |
| Fotos | `@vercel/blob` | 2.x (verificado 2.9.0; mínimo 2.3 para almacén privado) | `issueSignedToken`, `presignUrl`, `head`, `get`, `del` |
| Contrato | openapi-typescript, openapi-fetch, @redocly/cli | 7.x, 0.17.x, 2.x | ADR 0013 |
| Pruebas unitarias, de integración y del bot | Vitest | 5.x (verificado 5.1.0; Node 22.12+, 24 o 26+) | Integración contra PostgreSQL local real con base temporal por ejecución |
| Pruebas de extremo a extremo de la Mini App | Playwright | 1.x (verificado 1.65.1) | Inyecta un `Telegram.WebApp` simulado con `initData` firmado con el token de prueba |
| Calidad | TypeScript estricto, ESLint | — | Reglas de fronteras (ADR 0013) |

Tipos de prueba:
- **Unitarias** (`tests/unit`): dominio puro (transiciones, validación de enlaces de Maps, normalización, firma de `initData`).
- **Integración** (`tests/integration`): servicios y route handlers contra PostgreSQL con el rol `eje_app`; cubren cada invariante (acceso cruzado entre prestadores, visitante contra endpoints de administrador, transiciones prohibidas, duplicados, límites de fotos con simulador de almacenamiento).
- **Bot** (`tests/bot`): actualizaciones falsas con `bot.handleUpdate` y API de Telegram interceptada (ADR 0008); cancelación y entradas inválidas (F028).
- **Extremo a extremo** (`tests/e2e`): Playwright sobre `next dev` o `next start` con base de pruebas.
- **Humo** (`init.sh`): instalar, verificar contrato, levantar base local, migrar, correr un subconjunto rápido.
- **Evidencias:** Vitest con reportero JUnit y Playwright con reporte HTML, trazas y capturas en `qa/evidencias/<id>/` (las rutas finales las fija qa-evaluator).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Prisma | ORM popular con migraciones | Las restricciones de exclusión, disparadores y políticas RLS requieren SQL a mano igualmente; motor adicional en serverless |
| Drizzle ORM y drizzle-kit | Ligero, esquema en TypeScript | Duplica el esquema (TypeScript y SQL de disparadores); drizzle-kit no genera exclusiones ni disparadores |
| supabase-js | Cliente oficial | Pasa por la Data API que se desactiva (ADR 0006) |
| PGlite o base en memoria para pruebas | Sin Docker | No garantiza las mismas extensiones (`btree_gist`, `unaccent`) ni roles que Supabase |
| Jest | Conocido | Vitest es más rápido con TypeScript y ESM |

## Consecuencias
- Más fácil: una sola fuente del esquema (migraciones SQL); pruebas de invariantes contra la base real.
- Más difícil: Docker es requisito para el desarrollo local y para las pruebas de integración.
- Las versiones exactas quedan en `pnpm-lock.yaml`; cualquier actualización mayor requiere un ADR nuevo.
