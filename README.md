# Eje Turismo

Plataforma para promover y descubrir destinos, atractivos, servicios y experiencias turísticas de Manizales y los municipios del Eje Cafetero. La información turística suele estar dispersa en redes sociales, páginas y contactos individuales; Eje Turismo la reúne en un solo lugar, organizada y confiable.

Su interfaz principal es un **bot de Telegram** (comandos, botones y formularios conversacionales), acompañado de una **Telegram Mini App** para las vistas más amplias, y respaldado por un backend con roles y permisos.

## Quién la usa

| Rol | Qué hace |
| --- | --- |
| Visitante o turista | Explora destinos y atractivos, revisa fotografías, ubicación, horarios y datos de contacto, y envía solicitudes de información o interés. No necesita registro. |
| Prestador u operador turístico | Registra y actualiza la información de su establecimiento, servicio o experiencia, y atiende las solicitudes que le llegan. |
| Administrador | Gestiona municipios, categorías, contenidos y usuarios autorizados, y aprueba o rechaza lo que registran los prestadores. |

## Qué ofrece

- Información de municipios, zonas y destinos, y fichas de atractivos naturales, culturales, históricos y patrimoniales.
- Establecimientos y alojamientos (hoteles, fincas cafeteras, alojamientos rurales), restaurantes y cafés, rutas y experiencias, y agenda de eventos.
- Fotografías y ubicación mediante enlace a Google Maps.
- Solicitudes de información o interés (nombre, fecha de interés, número de personas y mensaje), que se remiten al prestador con una alerta en Telegram.

## Reglas principales

- Solo el administrador aprueba o rechaza lo que registra un prestador. El visitante solo ve fichas publicadas; si se edita una ficha publicada, la versión anterior sigue visible hasta que se apruebe la nueva.
- El rol de administrador o prestador existe solo si el administrador autorizó el ID de Telegram.
- Cada prestador ve y edita únicamente la información de su negocio.
- El backend verifica usuario, rol, negocio y permisos en cada operación.
- No hay motor de reservas, pagos ni administración hotelera.
- Los datos personales se tratan conforme a la Ley 1581 de 2012, con aviso de privacidad aceptado antes de recolectarlos.

El contexto completo y aprobado del producto está en [docs/00-contexto-producto.md](docs/00-contexto-producto.md).

## Stack

TypeScript, Next.js (rutas API y Mini App), grammY (bot por webhook), PostgreSQL en Supabase, Vercel Blob para fotografías y publicación en Vercel.

## Cómo ejecutarlo

### Requisitos

- Node.js 24.x
- pnpm 10.33.0 (se activa con `corepack enable`)
- PostgreSQL 17 local (por ejemplo, el de Homebrew) para la base de datos de desarrollo

### Pasos

1. Copia las variables de entorno y complétalas. Nunca subas `.env` al repositorio.

   ```bash
   cp .env.example .env
   ```

   Las variables están agrupadas así:

   | Grupo | Variables |
   | --- | --- |
   | Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `PRINCIPAL_ADMIN_TELEGRAM_ID`, `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` |
   | Base de datos | `DATABASE_URL`, `DATABASE_MIGRATIONS_URL` |
   | PostgreSQL local (solo desarrollo) | `PG_BIN`, `LOCAL_PG_SUPERUSER_URL`, `LOCAL_DB_NAME`, `LOCAL_DATABASE_MIGRATIONS_URL` (valores típicos en `docs/adr/0014`) |
   | Fotografías (Vercel Blob) | `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN`, `BLOB_STORAGE_QUOTA_BYTES`, `PHOTO_MAX_BYTES` |
   | Datos sensibles | `IDENTITY_ENCRYPTION_KEY`, `IDENTITY_HASH_KEY` (base64 de 32 bytes, por ejemplo con `openssl rand -base64 32`), `BOT_SENSITIVE_DRAFT_TTL_SECONDS` |
   | Otras | `RATE_LIMITS` (JSON opcional), `CRON_SECRET`, `APP_BASE_URL`, `PORT` |

2. Ejecuta el script de inicialización:

   ```bash
   ./init.sh
   ```

   El script se puede repetir cuantas veces haga falta y hace lo siguiente: instala dependencias (`pnpm install --frozen-lockfile`), verifica el contrato de la API (`pnpm api:check`), levanta y reinicia la base local (`pnpm db:bootstrap` y `pnpm db:reset`; si PostgreSQL local no está listo, avisa y los omite), revisa los tipos (`pnpm typecheck`) y corre la prueba de humo (`pnpm test:smoke`). La prueba de humo no necesita `.env`; la aplicación y el bot sí.

3. Levanta la aplicación en desarrollo:

   ```bash
   pnpm dev
   ```

   Queda en http://localhost:3000 (o el `PORT` que definas); el estado de salud está en `/api/health`.

### Comandos útiles

| Comando | Para qué sirve |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Desarrollo, compilación y ejecución en modo producción |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Migraciones, datos iniciales y reinicio de la base local |
| `pnpm db:push` | Aplica las migraciones en Supabase (usa `DATABASE_MIGRATIONS_URL`) |
| `pnpm api:types` / `pnpm api:lint` / `pnpm api:check` | Generar, validar y verificar el contrato `api/openapi.yaml` |
| `pnpm typecheck` / `pnpm lint` | Revisión de tipos y de estilo |
| `pnpm test`, `test:unit`, `test:integration`, `test:bot`, `test:e2e` | Pruebas |
| `pnpm bot:set-webhook` | Registra el webhook del bot de Telegram |

## Documentación

- Contexto del producto: [docs/00-contexto-producto.md](docs/00-contexto-producto.md)
- Contrato de la API: [api/openapi.yaml](api/openapi.yaml)
- Bitácora de trabajo: [progress.md](progress.md)
