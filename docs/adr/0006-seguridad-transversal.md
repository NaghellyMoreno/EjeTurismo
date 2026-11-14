# 0006. Seguridad transversal: validación, límites de intentos, cabeceras, CORS, CSRF, auditoría y acceso a la base

- **Estado:** Propuesta
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.11, 3.12, 3.15 y 3.16; CLAUDE.md (Seguridad); RNF-001, RNF-008, RNF-011 a RNF-015

## Contexto
El contexto pide autenticación y autorización en el backend, verificación en cada operación, acceso solo a información autorizada, protección de datos personales, validación y prevención de duplicados, trazabilidad y credenciales fuera del repositorio. La Mini App se abre dentro de Telegram (WebView en móviles e iframe en Telegram Web).

## Decisión
**Validación de entrada.**
- Cada endpoint valida cuerpo, parámetros y consulta con esquemas Zod equivalentes a `api/openapi.yaml`; campos desconocidos se rechazan (`strict`). Los manejadores del bot validan cada paso con los mismos esquemas de dominio.
- Textos: recorte de espacios, rechazo de caracteres de control; los textos que el bot envía se escapan para el modo de formato que use (o se envían sin `parse_mode`), para evitar inyección de formato.
- Callback data del bot (máximo 64 bytes según la Bot API): prefijo corto y UUID; se valida y nunca se confía en ella para autorizar, solo para identificar el recurso que el servicio vuelve a autorizar.

**Límites de intentos (revisado en la iteración 1 de preparación; D-008, D-039).**
Regla: ningún contador guarda el ID de Telegram, la IP ni otro identificador de una persona que no ha aceptado el aviso. Solo cuentan intentos de cuentas existentes, es decir, de personas que ya aceptaron (D-008, D-039).
- Tabla `rate_limit_counters(account_id, action, window_start, count)`, con PK `(account_id, action, window_start)`, `account_id` FK a `accounts` con `ON DELETE CASCADE` (se borra al revocar y en la eliminación del 31 de enero de 2027) e incremento atómico (`INSERT ... ON CONFLICT DO UPDATE`). No tiene columnas de IP ni de ID de Telegram.
- Acciones limitadas, todas de cuentas con aviso aceptado: `provider_registration` (registro de prestador), `information_request` (solicitudes), `photo_upload` (URLs de subida) y `bot_update` (actualizaciones del bot por cuenta). Al superar el límite, la API responde 429 `rate_limited` y el bot responde con un mensaje en español sin procesar la acción.
- **Quien no aceptó el aviso no tiene contador persistente.** Lo que puede hacer está acotado por diseño, sin escribir nada:
  - Bot: Telegram solo entrega actualizaciones con el secreto del webhook (ADR 0003). Antes de aceptar, el bot solo responde con el aviso (D-039). "No acepto" no escribe nada, y "Acepto" crea la cuenta (operación idempotente). Telegram limita además los mensajes que el bot puede enviar por chat.
  - Mini App y API: la validación HMAC de `initData` se hace en memoria, sin consultar la base. Una firma inválida responde 401 sin registrar la IP ni el contenido. Sin cuenta, las únicas operaciones disponibles son leer el aviso, consultar `getMe` (lectura) y aceptar.
  - Plataforma: la mitigación DDoS automática del Firewall de Vercel, activa por defecto en todos los planes, actúa antes de la función. La aplicación no ve ni guarda lo que esa capa procesa.
- Las cifras de cada límite no están en el contexto: Pendiente de aprobación, con los valores recomendados de `docs/03-arquitectura.md`. Se leen de configuración.

**Cabeceras** (configuradas en `next.config` para todas las rutas):
- `Content-Security-Policy`: `default-src 'self'`; `script-src 'self' https://telegram.org` (script oficial `telegram-web-app.js`); `img-src 'self' blob: data: https://*.blob.vercel-storage.com`; `connect-src 'self' https://*.blob.vercel-storage.com`; `frame-ancestors https://web.telegram.org https://*.telegram.org` (Telegram Web incrusta la Mini App en un iframe; por eso no se usa `X-Frame-Options: DENY`).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` (Vercel sirve solo HTTPS), `Permissions-Policy` restrictiva.
- Respuestas de la API con `Cache-Control: no-store`, salvo catálogos públicos.

**CORS.** No se emiten cabeceras CORS: la Mini App y la API comparten origen. Cualquier origen ajeno queda bloqueado por el navegador.

**CSRF.** No hay cookies de sesión (ADR 0003); la credencial viaja en la cabecera `Authorization`, que un sitio ajeno no puede adjuntar. No se requiere token CSRF.

**Acceso a la base de datos.**
- Las tablas viven en el esquema `app`, que no se expone en la Data API de Supabase; además se desactiva "Enable Data API" en el proyecto. Las claves `anon` y `service_role` no se usan ni se distribuyen.
- RLS activo en todas las tablas con una política que solo permite al rol `eje_app`; así, aunque la Data API se reactivara, los roles `anon` y `authenticated` no ven nada.
- La aplicación se conecta con el rol `eje_app` (solo DML en `app`, sin DDL). `listing_status_events`, `audit_events` y `consent_events`: solo `INSERT` y `SELECT` para `eje_app`; el borrado de estas tablas solo lo hace la función de eliminación del 31 de enero de 2027 (ADR 0007).
- Las migraciones se ejecutan con el rol propietario desde la máquina de la responsable o desde el flujo de publicación, nunca desde la aplicación.

**Auditoría y trazabilidad (sección 3.12).**
- `audit_events(occurred_at, actor_account_id, actor_role, action, entity_type, entity_id, details)` para: aceptación y revocación (sin datos personales en `details`), registro, autorización, rechazo, revocación de rol, alta y edición de municipios y listas, cambios de estado de solicitudes.
- `listing_status_events` para fichas (HU-028), escrito por disparador.
- `details` nunca contiene número de identidad, textos de solicitudes ni `initData`.
- Fechas en `timestamptz` (UTC); se muestran en America/Bogota (RNF-016).

**Credenciales.** Solo en `.env` local (no se lee ni se sube) y en variables de Vercel; `.env.example` con nombres sin valores. Validación de variables al iniciar; si falta una obligatoria, la función falla en lugar de funcionar abierta.

**Errores.** Formato único `application/problem+json` sin trazas ni datos personales (ADR 0001, `docs/03-arquitectura.md`).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Límites de intentos en Redis o Upstash | Muy rápido | Proveedor adicional fuera del stack fijo |
| Contador por IP o por ID de Telegram antes de aceptar el aviso (diseño anterior) | Frena abusos anónimos | Guarda datos de quien no aceptó: contradice D-008 y D-039 |
| Contador en memoria de la instancia para quien no aceptó | No persiste | Inútil en serverless, porque cada instancia tiene su propia memoria. Igual procesa un identificador sin autorización; se descarta |
| Usar supabase-js con la clave `service_role` | Cliente oficial | Clave con privilegio total en la aplicación; pasa por la Data API que se quiere desactivar |
| Token CSRF | Defensa clásica | Innecesario sin cookies |

## Consecuencias
- Más fácil: superficie de ataque reducida a la API propia y al webhook.
- Más difícil: el rol `eje_app` y las políticas RLS deben crearse en migraciones; las pruebas de integración usan el mismo rol para detectar permisos faltantes.
- La CSP debe ajustarse si se añade otro origen (por ejemplo, un dominio propio para Blob).
- Riesgo aceptado: no hay límite propio para quien no aceptó el aviso. Un abuso anónimo solo consume lecturas del aviso y validaciones HMAC, que no escriben nada. La protección queda a cargo de la plataforma y de Telegram.
- Los registros de plataforma de Vercel pueden contener datos técnicos de la petición, como la IP. La aplicación no los escribe ni los lee, y su retención depende del proveedor (ver riesgos en `docs/03-arquitectura.md`).
