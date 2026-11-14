# 0003. Autenticación con identidad de Telegram verificada, sin sesiones propias, y roles leídos de la base de datos

- **Estado:** Propuesta (revisada en la iteración 1 de preparación: D-037 a D-039, D-043, D-044)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 2.3, 3.11 y 3.16; RNF-001, RNF-004, RNF-014; D-007, D-015, D-020, D-032, D-037, D-038, D-039, D-043, D-044; guía de agentes (architect)

## Contexto
La identidad de cada persona es su ID de Telegram (sección 2.3). Hay dos canales: el bot (webhook) y la Mini App. En ninguno se puede confiar en datos que la interfaz declare: en la Mini App `initDataUnsafe` no es confiable y solo `initData` validado en el servidor lo es (documentación de Telegram Mini Apps); en el bot, el `from.id` solo es confiable si la petición viene de Telegram.

## Decisión
**Bot (webhook).**
- Telegram llama a `POST /api/v1/telegram/webhook` con la cabecera `X-Telegram-Bot-Api-Secret-Token`, cuyo valor se fija con `setWebhook(secret_token)` y se guarda en `TELEGRAM_WEBHOOK_SECRET` (1 a 256 caracteres `A-Z a-z 0-9 _ -`, según la Bot API).
- grammY compara la cabecera con `webhookCallback(bot, 'std/http', { secretToken })`. Como grammY acepta todo si `secretToken` no está definido, la aplicación **no arranca** si falta la variable (validación de entorno al iniciar, fail closed).
- Con la petición autenticada, el actor es `update.from.id`. Nunca se usa `chat_id` como prueba de rol.

**Mini App.**
- Cada petición a `/api/v1/...` lleva `Authorization: tma <initData>` (cadena cruda de `Telegram.WebApp.initData`).
- El backend valida: `secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)`; `hash == hex(HMAC_SHA256(data_check_string, secret_key))` con comparación en tiempo constante; `data_check_string` = campos ordenados alfabéticamente sin `hash`, unidos por salto de línea (procedimiento oficial de Telegram).
- Se rechaza si `auth_date` es más antiguo que `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (valor por defecto 86400; pendiente de aprobación en `docs/03-arquitectura.md`).
- Una firma inválida responde 401 sin consultar la base y sin registrar la IP ni el contenido de `initData` (ADR 0006; D-008).
- Implementación propia con `node:crypto` (sin librería), con pruebas que cubren firma válida, firma alterada, cambio de `user.id`, ausencia de `initData` y `auth_date` vencido (F009).

**Sesiones.** No hay cookies ni sesiones de la aplicación: cada petición se autentica por sí misma. En consecuencia no hay riesgo de CSRF por cookies (ADR 0006). El bot guarda estado de formularios, no de autenticación (ADR 0015).

**Actor y roles.**
- `Actor = { telegramUserId, accountId | null, consentVersion | null, roles: Set<'admin'|'provider'>, isPrincipalAdmin }`, construido en el backend en cada petición o actualización.
- `accountId` existe solo si la persona aceptó el aviso (D-008). Sin cuenta, el actor solo puede leer el aviso, consultar su estado (`getMe`) y aceptar. No puede explorar fichas ni catálogos en ningún canal (D-039). Con una cuenta que aceptó una versión anterior, además puede revocar (ADR 0005).
- Niveles de acceso del contrato (`x-roles`): `public` (solo el aviso), `telegram_user` (identidad válida), `account_holder` (tiene cuenta, con cualquier versión aceptada), `consented_user` (aceptó la versión vigente), `provider` y `admin`.
- Roles: se leen de `role_grants` activos en cada operación. `admin` también lo tiene quien coincide con `PRINCIPAL_ADMIN_TELEGRAM_ID` (D-007), que al aceptar el aviso queda reflejado en una fila `is_principal = true` para que los disparadores lo reconozcan (ADR 0002).
- Visitante: cualquier persona; no requiere rol.
- Prestador: permiso `provider` activo creado al aprobar su registro (HU-003).
- Administrador y prestador no coexisten en la misma cuenta (D-038; mecanismo en ADR 0005).
- Administrador autorizado antes de aceptar: su ID se guarda en `role_grants` (D-037), pero el permiso solo se usa cuando existe la cuenta con el aviso vigente.
- Revocar rol (D-015, D-020): marca `revoked_at`; la siguiente operación ya no lo encuentra. Está prohibido sobre el administrador principal (regla aprobada en D-044) y sobre el único administrador activo, verificado con bloqueo de las filas de administradores. Sobre un prestador, solo le quita el rol (D-043; efectos en ADR 0004).

**Matriz de permisos (resumen).** La matriz por endpoint está en `api/openapi.yaml` (extensión `x-roles`) y en `docs/03-arquitectura.md`.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Sesión con cookie tras validar `initData` una vez | Menos validaciones HMAC | Introduce CSRF, almacenamiento de sesiones y cookies de terceros dentro del WebView de Telegram; la validación HMAC cuesta microsegundos |
| Validación por firma Ed25519 (`signature`) | No necesita el token del bot | Pensada para terceros; el backend ya tiene el token |
| Librería externa de validación de `initData` | Menos código | Dependencia más para un algoritmo corto y documentado; se prefiere código propio con pruebas |
| Caché de roles en memoria | Menos consultas | Una revocación no tendría efecto inmediato en otras instancias (F006 exige rechazo en la siguiente operación) |

## Consecuencias
- Más fácil: autorización uniforme para bot y Mini App; revocación inmediata.
- Más difícil: una consulta de roles por operación (aceptable: índice por `telegram_user_id`).
- Si la Mini App queda abierta más tiempo que la vigencia de `initData`, la persona debe reabrirla; la Mini App muestra un mensaje claro.
- Riesgo: si se filtra el token del bot, se pueden falsificar `initData` y llamadas a la API de Telegram. Mitigación: token solo en variables de entorno, un bot por entorno (ADR 0012).
