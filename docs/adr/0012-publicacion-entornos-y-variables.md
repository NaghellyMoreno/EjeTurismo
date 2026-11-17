# 0012. Publicación en Vercel: entornos, variables de entorno y desarrollo local

- **Estado:** Propuesta (planes, regiones y bots fijados por D-035; revisada en la iteración 1 de preparación; desarrollo local revisado el 2026-11-15 por D-063)
- **Fecha:** 2026-11-14
- **Fuente:** sección 3.17; CLAUDE.md (Stack y publicación, Seguridad); RNF-015; D-007, D-026, D-035, D-036, D-042; documentación de Vercel y Supabase

## Contexto
Publicación fija en Vercel, sin proceso permanente ni disco. La base de datos está en Supabase y las fotos en Vercel Blob. Credenciales solo en `.env` y en variables de la plataforma.

## Decisión
**Planes (D-035).** Vercel Hobby y Supabase Free. Consecuencias que el diseño ya absorbe:
- Cron una vez al día con precisión de una hora (ADR 0007).
- 1 GB de Blob incluido, protegido por la cuota de 900 MB (ADR 0009).
- Dos proyectos activos de Supabase, que son los dos entornos.
- Sin copias de seguridad automáticas en Supabase Free.
- Pausa del proyecto tras 7 días con poca actividad. Según la documentación de Supabase, consultada el 2026-11-14, un proyecto pausado se puede restaurar.

**Partes y cómo se despliegan.**
| Parte | Dónde | Cómo |
| --- | --- | --- |
| Mini App (páginas Next.js) | Vercel | Despliegue del proyecto (rama principal = producción; otras ramas = vista previa) |
| API `/api/v1/...` y webhook del bot | Vercel Functions (Node.js 24.x, Fluid compute, región elegida en ADR 0010) | Mismo despliegue |
| Tareas diarias | Vercel Cron (`vercel.json`) | Mismo despliegue; solo se ejecutan en producción |
| Base de datos | Supabase (proyecto por entorno) | Migraciones con `supabase db push` desde la máquina de la responsable, antes de desplegar código que las necesite |
| Fotos | Vercel Blob (almacén privado por entorno) | Se crea una vez y se conecta al proyecto |
| Webhook | Telegram | `pnpm bot:set-webhook` tras cada cambio de dominio |

**Entornos.**
| Entorno | Base | Blob | Bot |
| --- | --- | --- | --- |
| Local | PostgreSQL 17 de Homebrew (D-063; ADR 0014) | Almacén de desarrollo o simulador en memoria para pruebas | Bot de desarrollo (polling local o túnel) |
| Vista previa (Vercel Preview) | Proyecto Supabase de desarrollo (`sa-east-1`) | Almacén de desarrollo (`gru1`) | Bot de desarrollo (D-035) |
| Producción | Proyecto Supabase de producción (`sa-east-1`) | Almacén de producción (`gru1`) | Bot de producción (D-035) |

Bots (D-035): la usuaria crea dos bots en BotFather. El de desarrollo se usa en local y en vista previa, y el de producción solo en producción. Como el bot de desarrollo tiene un solo webhook, apunta a una sola URL a la vez (la de una vista previa o el túnel local). Se cambia con `pnpm bot:set-webhook`.

**Variables de entorno** (nombres en `.env.example`, sin valores):
| Variable | Uso | Secreta |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot API y validación de `initData` | Sí |
| `TELEGRAM_WEBHOOK_SECRET` | Cabecera del webhook | Sí |
| `TELEGRAM_BOT_USERNAME` | Enlaces a la Mini App | No |
| `PRINCIPAL_ADMIN_TELEGRAM_ID` | Administrador principal (D-007, D-032) | No, pero es dato personal: solo en variables |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` | Vigencia de `initData` (valor por defecto 86400, pendiente de aprobación) | No |
| `DATABASE_URL` | Conexión de la aplicación con el rol `eje_app` por el pooler compartido en modo transacción (puerto 6543, SSL obligatorio). En local apunta al PostgreSQL de Homebrew, sin SSL y solo en `localhost` (ADR 0014) | Sí |
| `DATABASE_CA_CERT` | Certificado raíz de Supabase en formato PEM (se descarga en Database Settings, SSL Configuration). La conexión de la nube verifica el servidor con él; sin un certificado válido no se conecta. `DATABASE_URL` no lleva `sslmode`. En local no se usa | No, pero va solo en variables |
| `DATABASE_MIGRATIONS_URL` | Solo en la máquina de la responsable, para migraciones y semilla de referencia en la nube (`db:push`, `db:seed:reference`). En local se usa `LOCAL_DATABASE_MIGRATIONS_URL` (ADR 0014) | Sí |
| `BLOB_READ_WRITE_TOKEN` o conexión OIDC (`BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN`) | Acceso a Blob; Vercel las agrega al conectar el almacén | Sí |
| `BLOB_STORAGE_QUOTA_BYTES` | Cuota global: 900000000 en producción (D-042); en vista previa se puede bajar para que QA verifique la cuota (ADR 0009) | No |
| `PHOTO_MAX_BYTES` | Tamaño máximo por foto: 5000000 (D-042) | No |
| `IDENTITY_ENCRYPTION_KEY` | Cifrado del número de identidad en el registro y en la sesión del bot (32 bytes en base64) | Sí |
| `IDENTITY_HASH_KEY` | HMAC del número de identidad | Sí |
| `BOT_SENSITIVE_DRAFT_TTL_SECONDS` | Vigencia del número de identidad sellado en la sesión del bot (por defecto 600, ADR 0015) | No |
| `RATE_LIMITS` | Cifras de los límites de intentos por cuenta (JSON; valores por defecto en `docs/03-arquitectura.md`) | No |
| `CRON_SECRET` | Autenticación de las tareas diarias | Sí |
| `APP_BASE_URL` | URL pública de la Mini App | No |

Un módulo `src/server/config/env.ts` valida todas las variables con Zod al cargar; si falta una obligatoria, la función falla al iniciar (fail closed).

**Conexión a la base desde funciones.** Pooler compartido de Supabase en modo transacción (puerto 6543), un cliente por instancia creado en el módulo, tamaño de grupo 1, SSL obligatorio y verificado con `DATABASE_CA_CERT`, sin sentencias preparadas con nombre y sin estado de sesión (`SET LOCAL` y `set_config(..., true)` dentro de transacciones), según la guía de Supabase para serverless.

**Desarrollo local.**
- PostgreSQL 17 de Homebrew, levantado con `brew services start postgresql@17`, sin Docker (D-063). `pnpm db:bootstrap` crea los roles locales y `pnpm db:reset` recrea la base de desarrollo con migraciones y semillas. Los scripts y las variables solo locales están en la ADR 0014.
- `pnpm dev` levanta Next.js en el puerto de `PORT` (por defecto 3000), para no fijar puertos en el modo paralelo.
- Pruebas de integración: cada ejecución crea una base temporal con nombre aleatorio en el PostgreSQL local a partir de las migraciones y la borra al terminar, para no fijar bases en el modo paralelo (ADR 0014).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Un solo proyecto Supabase para todo | Menos configuración | Pruebas sobre datos reales; riesgo para la demostración |
| Migraciones automáticas en cada despliegue de Vercel | Menos pasos | La función de compilación necesitaría credenciales de propietario de la base; un error de migración rompe producción sin revisión |

## Consecuencias
- Más fácil: entornos aislados; producción sin datos de prueba.
- Más difícil: dos proyectos de Supabase y dos bots que crear y mantener.
- Riesgo: Supabase Free pausa el proyecto tras 7 días con poca actividad. Mitigación: abrir el proyecto en el panel o usar el bot unos días antes de la demostración y antes del 31 de enero de 2027, porque con el proyecto pausado la tarea de eliminación no se puede ejecutar.
- Ya no existe `CONSENT_SUBJECT_KEY`: la prueba de consentimiento no guarda pseudónimo (D-036).
