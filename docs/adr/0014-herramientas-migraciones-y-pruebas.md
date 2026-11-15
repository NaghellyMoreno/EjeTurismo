# 0014. Herramientas: pnpm, migraciones SQL con psql y la CLI de Supabase, PostgreSQL local de Homebrew, Kysely, Vitest y Playwright

- **Estado:** Aprobada (D-044). Revisada el 2026-11-15 por D-062 (TypeScript 5.x), D-063 (base local con PostgreSQL de Homebrew en lugar de Docker) y D-064 (`/api/health` solo como prueba de vida; anotar D-062 aquí)
- **Fecha:** 2026-11-14 (revisión: 2026-11-15)
- **Fuente:** sección 3.13 (pruebas y evidencias como entregables); CLAUDE.md (Stack); guía de agentes (developer, qa-evaluator); D-044, D-061, D-062, D-063, D-064

## Contexto
Se necesitan herramientas para instalar, migrar, consultar la base, probar backend, bot, Mini App y extremo a extremo, y guardar evidencias de pruebas (entregable). Las restricciones de la base (exclusión, disparadores, RLS, roles) se escriben mejor en SQL. Versiones verificadas en el registro de npm y en la documentación oficial el 2026-11-14 y, para esta revisión, el 2026-11-15.

Cambios de esta revisión:
- D-063: no se usa Docker. La base local de desarrollo y de pruebas es PostgreSQL instalado con Homebrew, así que `supabase start` y `supabase db reset` ya no se usan, porque los dos levantan contenedores.
- D-062: TypeScript queda en 5.x. openapi-typescript 7.13.0 declara `peerDependencies.typescript: ^5.x` (registro de npm, 2026-11-15), y con TypeScript 7 (la última es 7.0.2) falla.
- D-064: `/api/health` es solo prueba de vida. Las herramientas de esta ADR no la usan para verificar la base ni Blob.

## Decisión
| Para qué | Herramienta | Versión fijada | Nota |
| --- | --- | --- | --- |
| Entorno de ejecución | Node.js | 24.x (`engines.node`) | Soportada por Vercel (22.x, 24.x y 26.x disponibles) |
| Gestor de paquetes | pnpm | 10.x (`packageManager` con Corepack) | Vercel soporta pnpm 6 a 12; 10 usa `lockfileVersion: 9.0` |
| Framework | Next.js | 16.x (verificado 16.4.6) | App Router, route handlers, `after()` |
| Bot | grammY | 1.x (verificado 1.46.0) | Sesión propia con almacenamiento en PostgreSQL (ADR 0015) |
| Validación | Zod | 4.x (verificado 4.6.7) | Entrada de API y pasos del bot |
| Acceso a la base | Kysely + `pg` | Kysely 0.29.x (verificado 0.29.9), `pg` 8.x (verificado 8.23.1) | SQL tipado, transacciones, `FOR UPDATE`; sin sentencias preparadas con nombre (pooler en modo transacción) |
| Tipos de la base | kysely-codegen | 0.20.x | Desde la base local de desarrollo migrada |
| Base local de desarrollo y pruebas | PostgreSQL de Homebrew (fórmula `postgresql@17`) | 17.x (verificado 17.12 en formulae.brew.sh, 2026-11-15) | Misma versión mayor que Supabase (17 es la predeterminada de la plataforma; `supabase/config.toml` tiene `major_version = 17`). Extensiones `btree_gist` y `unaccent` del paquete contrib. Sin Docker (D-063) |
| Aplicar migraciones y semillas en local | `psql` de Homebrew, llamado por scripts versionados en `scripts/db/` | El de `postgresql@17` | Reemplaza a `supabase db reset` (ver "Base local") |
| Crear migraciones y aplicarlas en la nube | CLI de Supabase | 3.x (verificado 3.1.0, paquete `supabase` como dependencia de desarrollo) | Solo `supabase migration new` y `supabase db push --db-url`, que no levantan contenedores. No se usan `start`, `db reset`, `db diff`, `db pull` ni `db dump`, porque necesitan Docker |
| Fotos | `@vercel/blob` | 2.x (verificado 2.9.0; mínimo 2.3 para almacén privado) | `issueSignedToken`, `presignUrl`, `head`, `get`, `del` |
| Contrato | openapi-typescript, openapi-fetch, @redocly/cli | 7.x (verificado 7.13.0), 0.17.x, 2.x | ADR 0013 |
| Lenguaje y verificación de tipos | TypeScript | **5.x** (verificado 5.9.3; D-062) | Fijado por la `peerDependency` `^5.x` de openapi-typescript 7.13.0. Pasar a TypeScript 7 requiere un ADR nuevo, cuando openapi-typescript lo admita |
| Pruebas unitarias, de integración y del bot | Vitest | 5.x (verificado 5.1.0; Node 22.12+, 24 o 26+) | Integración contra el PostgreSQL local real, con una base temporal por ejecución |
| Pruebas de extremo a extremo de la Mini App | Playwright | 1.x (verificado 1.65.1) | Inyecta un `Telegram.WebApp` simulado con `initData` firmado con el token de prueba |
| Calidad | TypeScript estricto (5.x), ESLint | — | Reglas de fronteras (ADR 0013) |

### Base local con PostgreSQL de Homebrew (D-063)
**Instalación, una vez por máquina (manual, fuera de los scripts):**
- `brew install postgresql@17`. La fórmula es keg-only: sus binarios (`psql`, `pg_isready`, `createdb`) no quedan en el `PATH`. Los scripts los buscan en `PG_BIN` si está definida y, si no, en `$(brew --prefix postgresql@17)/bin`.
- `brew services start postgresql@17` levanta el servidor como servicio de launchd. Queda activo entre reinicios y escucha en `localhost:5432`. El clúster está en `$(brew --prefix)/var/postgresql@17`.
- Para reiniciar el servidor: `brew services restart postgresql@17`. Para detenerlo: `brew services stop postgresql@17`.
- Ningún script de `package.json` ni `init.sh` inicia o detiene el servicio, para no dejar procesos en segundo plano. Si el servidor no responde, los scripts lo indican y terminan con error.

**Qué replica de Supabase y qué no.**

Replica:
- la versión mayor;
- las extensiones `btree_gist` y `unaccent`;
- el esquema `extensions`;
- los roles propios de Supabase que nombran las migraciones;
- el historial de migraciones en `supabase_migrations.schema_migrations`.

No replica:
- el pooler en modo transacción;
- SSL;
- la Data API, Auth y Studio.

Lo que no replica se verifica en el proyecto de desarrollo de Supabase (ver "Consecuencias").

**Script de arranque versionado: `supabase/local/bootstrap.sql`.**
- Solo para local. Lo ejecuta el superusuario del clúster de Homebrew, que es el usuario de macOS. Es idempotente: crea cada rol solo si no existe.
- Crea los roles que Supabase ya trae y que las migraciones pueden nombrar:
  - `postgres`: `LOGIN CREATEDB CREATEROLE`, sin `SUPERUSER`, igual que en Supabase. Es el rol de migraciones en local.
  - `anon`, `authenticated` y `service_role`: `NOLOGIN`. Solo existen para que los `REVOKE` y las políticas de ADR 0006 se apliquen igual que en la nube.
- No crea `eje_app`. Ese rol, sus permisos y las políticas RLS los crea la migración versionada, idéntica en local y en la nube (ADR 0006). La migración usa `CREATE ROLE eje_app LOGIN` dentro de un bloque `DO` que comprueba si ya existe, y nunca incluye contraseña.
- Verificaciones previas, que fallan con un mensaje claro:
  - `server_version_num` de la versión mayor 17;
  - `btree_gist` y `unaccent` presentes en `pg_available_extensions`.

**Reglas para que una migración sirva en local y en la nube.**
- Cada archivo de `supabase/migrations/` empieza con `create schema if not exists extensions;` cuando crea extensiones, y las crea con `create extension if not exists btree_gist with schema extensions;` (igual con `unaccent`). Las dos son extensiones confiables (*trusted*), así que el rol `postgres` sin superusuario puede crearlas en una base que le pertenece.
- No usa objetos que solo existen en Supabase (`auth`, `storage`, `supabase_admin`, `pgsodium`, Vault) ni opciones del servidor que no se puedan fijar por base.
- Se ejecuta completa en una transacción (`psql --single-transaction -v ON_ERROR_STOP=1`).
- No lleva contraseñas, claves ni datos personales.

**Historial de migraciones.**
- En local, el script de migración usa la misma tabla que la CLI de Supabase en la nube: `supabase_migrations.schema_migrations (version text primary key, name text, statements text[])`. La crea si no existe.
- `version` es el prefijo numérico del nombre del archivo, y `name` es el resto sin `.sql`.
- Un archivo cuya `version` ya está registrada no se vuelve a aplicar, igual que en `supabase db push`.

**Bases locales.**
| Base | Nombre | Dueña | Contenido | Cómo se crea o reinicia |
| --- | --- | --- | --- | --- |
| Desarrollo | `LOCAL_DB_NAME` (por defecto `eje_turismo_dev`; en modo paralelo cada copia usa su propio nombre) | `postgres` | Migraciones, `supabase/seed/reference.sql` y `supabase/seed/demo.sql` (ADR 0011) | `pnpm db:reset` |
| Pruebas de integración | `eje_turismo_test_<AAAAMMDDhhmmss>_<aleatorio>`, una por ejecución | `postgres` | Migraciones y `supabase/seed/reference.sql` (sin `demo.sql`; las pruebas usan fábricas, ADR 0011) | La crea el `globalSetup` de Vitest al empezar y la borra al terminar (`DROP DATABASE ... WITH (FORCE)`) |
| Extremo a extremo | `eje_turismo_e2e_<AAAAMMDDhhmmss>_<aleatorio>`, una por ejecución | `postgres` | Igual que la de integración | La crea el `globalSetup` de Playwright y la borra al terminar |

Las bases temporales que queden de una ejecución interrumpida se borran con `pnpm db:test:clean`. Este script solo borra bases `eje_turismo_test_*` y `eje_turismo_e2e_*` con más de una hora según la marca de tiempo de su nombre, para no tocar las de otra copia que esté corriendo en paralelo.

**Scripts de `package.json` (contrato para `init.sh` y para los agentes).** Son scripts de shell en `scripts/db/` que llaman a `psql`, porque las semillas usan `\ir` para incluir archivos (ADR 0011).
| Script | Qué hace | Conexión |
| --- | --- | --- |
| `pnpm db:bootstrap` | Comprueba que el servidor responde (`pg_isready`), la versión y las extensiones, y aplica `supabase/local/bootstrap.sql`. Idempotente | `LOCAL_PG_SUPERUSER_URL` |
| `pnpm db:migrate` | Crea la base de desarrollo si no existe y aplica, en orden lexicográfico, los archivos de `supabase/migrations/*.sql` que falten en el historial. Cada archivo va en su propia transacción y se registra en `supabase_migrations.schema_migrations` dentro de la misma transacción | `LOCAL_DATABASE_MIGRATIONS_URL` |
| `pnpm db:seed` | Carga `reference.sql` y después `demo.sql` en la base de desarrollo con el rol de migraciones. Se niega a correr si el host no es `localhost`, `127.0.0.1` o `::1` | `LOCAL_DATABASE_MIGRATIONS_URL` |
| `pnpm db:reset` | Reemplaza a `supabase db reset`: `db:bootstrap`, borra la base de desarrollo (`DROP DATABASE IF EXISTS ... WITH (FORCE)`), la crea de nuevo, y luego ejecuta `db:migrate` y `db:seed`. Solo actúa sobre hosts locales | `LOCAL_DATABASE_MIGRATIONS_URL` |
| `pnpm db:test:clean` | Borra las bases temporales abandonadas (regla de arriba) | `LOCAL_DATABASE_MIGRATIONS_URL` |
| `pnpm db:types` | kysely-codegen sobre la base de desarrollo migrada | `LOCAL_DATABASE_MIGRATIONS_URL` |
| `pnpm supabase migration new <nombre>` | Crea `supabase/migrations/<marca de tiempo>_<nombre>.sql` (CLI de Supabase, sin Docker) | — |
| `pnpm db:push` | `supabase db push --db-url "$DATABASE_MIGRATIONS_URL"` hacia un proyecto de Supabase en la nube. Primero desarrollo y después producción (ADR 0012) | `DATABASE_MIGRATIONS_URL` |
| `pnpm db:seed:reference` | Carga `reference.sql` en un proyecto de Supabase en la nube con `psql` (ADR 0011) | `DATABASE_MIGRATIONS_URL` |

Los scripts de migración y de semillas reciben opcionalmente el nombre de la base de destino (por defecto, `LOCAL_DB_NAME`). Los `globalSetup` de Vitest y Playwright los reutilizan para preparar sus bases temporales, así que no hay una segunda forma de aplicar migraciones. Para crear y borrar bases, los scripts se conectan como `postgres` a la base de mantenimiento `postgres`.

Ya no existe `pnpm db:start`, que levantaba Supabase en Docker. Lo reemplaza `pnpm db:bootstrap`, porque el servidor se levanta con `brew services`.

**Variables solo para local** (nombres en `.env.example`, sin valores):
| Variable | Uso | Valor típico (sin secretos) |
| --- | --- | --- |
| `PG_BIN` | Carpeta de binarios de PostgreSQL (opcional) | `$(brew --prefix postgresql@17)/bin` |
| `LOCAL_PG_SUPERUSER_URL` | Superusuario del clúster de Homebrew, solo para `db:bootstrap` | `postgresql://localhost:5432/postgres` (usuario de macOS) |
| `LOCAL_DB_NAME` | Nombre de la base de desarrollo | `eje_turismo_dev` |
| `LOCAL_DATABASE_MIGRATIONS_URL` | Rol `postgres` local: migraciones, semillas, creación y borrado de bases | `postgresql://postgres@localhost:5432/eje_turismo_dev` |
| `DATABASE_URL` (en local) | La aplicación con el rol `eje_app` | `postgresql://eje_app@localhost:5432/eje_turismo_dev` |

`DATABASE_MIGRATIONS_URL` queda reservada para la nube, para que un comando local no apunte por error a Supabase ni al revés.

En local no se usan contraseñas. Homebrew crea el clúster con autenticación `trust` solo para conexiones locales (`initdb` sin `--auth`), y el servidor escucha únicamente en `localhost`. Esto es **Inferido** y queda pendiente de aprobación (ver `docs/03-arquitectura.md`, Pendientes).

En la nube, la contraseña de `eje_app` la fija la responsable una vez por proyecto, fuera del repositorio, y solo queda en `DATABASE_URL` en las variables de Vercel. El SSL obligatorio de ADR 0012 se exige siempre, salvo cuando el host es `localhost`, `127.0.0.1` o `::1`.

### Tipos de prueba
- **Unitarias** (`tests/unit`): dominio puro (transiciones, validación de enlaces de Maps, normalización, firma de `initData`). No necesitan base.
- **Integración** (`tests/integration`): servicios y route handlers contra PostgreSQL local con el rol `eje_app`, sobre la base temporal de la ejecución. Cubren cada invariante: acceso cruzado entre prestadores, visitante contra endpoints de administrador, transiciones prohibidas, duplicados y límites de fotos con simulador de almacenamiento.
- **Bot** (`tests/bot`): actualizaciones falsas con `bot.handleUpdate` y API de Telegram interceptada (ADR 0008); cancelación y entradas inválidas (F028).
- **Extremo a extremo** (`tests/e2e`): Playwright sobre `next dev` o `next start`, con la base temporal de extremo a extremo.
- **Humo** (`init.sh`): instala, verifica el contrato, ejecuta `db:bootstrap` y `db:reset`, y corre `typecheck` y `test:smoke`. Si `pg_isready` falla, avisa, omite los pasos de base y sigue con lo demás.
  - `/api/health` es solo prueba de vida (D-064). No consulta la base ni Blob, y ni la prueba de humo ni QA la usan como prueba de que la base funciona.
- **Evidencias:** Vitest con reportero JUnit y Playwright con reporte HTML, trazas y capturas en `qa/evidencias/<id>/` (las rutas finales las fija qa-evaluator).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Supabase local en Docker (`supabase start` y `supabase db reset`), que era la decisión anterior | Réplica más fiel de Supabase (roles, extensiones, pooler, Studio) | Requiere Docker; descartada por D-063 |
| Postgres.app en lugar de Homebrew | Sin Homebrew, con interfaz gráfica | D-063 fija Homebrew; los scripts solo cambiarían en `PG_BIN` |
| Aplicar migraciones también en la nube con `psql` y sin la CLI | Una sola herramienta | Duplica lo que ya hace `supabase db push` con el mismo historial; queda solo como respaldo si `db push` fallara (ver "Consecuencias") |
| Prisma | ORM popular con migraciones | Las restricciones de exclusión, disparadores y políticas RLS requieren SQL a mano igualmente; motor adicional en serverless |
| Drizzle ORM y drizzle-kit | Ligero, esquema en TypeScript | Duplica el esquema (TypeScript y SQL de disparadores); drizzle-kit no genera exclusiones ni disparadores |
| supabase-js | Cliente oficial | Pasa por la Data API que se desactiva (ADR 0006) |
| PGlite o base en memoria para pruebas | Sin servidor | No garantiza las mismas extensiones (`btree_gist`, `unaccent`) ni roles que Supabase |
| TypeScript 7 | Versión más reciente (7.0.2) | openapi-typescript 7.13.0 exige `^5.x` y falla (D-062) |
| Jest | Conocido | Vitest es más rápido con TypeScript y ESM |

## Consecuencias
- Más fácil:
  - una sola fuente del esquema (migraciones SQL);
  - pruebas de invariantes contra un PostgreSQL real de la misma versión mayor;
  - no hay que instalar ni abrir Docker;
  - las bases de prueba con nombre aleatorio permiten el modo paralelo.
- Más difícil:
  - hay que instalar `postgresql@17` con Homebrew (solo macOS) y mantener `supabase/local/bootstrap.sql` y los scripts `db:*`;
  - la base local no tiene pooler, SSL ni los roles internos de Supabase, así que un error que solo aparece en la nube (sentencias preparadas con nombre en el pooler, permisos del rol `postgres` de Supabase) no se detecta en local.
  - Mitigación: cada migración se aplica primero al proyecto de desarrollo con `pnpm db:push`, y las pruebas contra el pooler de desarrollo (riesgo "Pooler de Supabase" en `docs/03-arquitectura.md`) se ejecutan antes de cerrar F001.
- **Inferido:** que `supabase db push --db-url` funcione sin Docker se basa en una respuesta de un mantenedor en el repositorio de la CLI. La documentación oficial lo confirma solo para `db diff`, `db pull` y `db dump`, que sí requieren Docker. Se comprueba con el primer `db push` al proyecto de desarrollo. Si fallara, `db:push` pasaría a ser un script con `psql` que escribe en el mismo `supabase_migrations.schema_migrations`, sin cambiar el contrato del comando.
- TypeScript queda en 5.x hasta que openapi-typescript admita la 7 (D-062).
- Las versiones exactas quedan en `pnpm-lock.yaml`; cualquier actualización mayor requiere un ADR nuevo.
