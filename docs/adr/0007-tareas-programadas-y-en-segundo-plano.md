# 0007. Tareas en segundo plano con bandeja de salida y `after()`, y tareas diarias con Vercel Cron

- **Estado:** Propuesta (revisada en la iteración 1 de preparación: M-10, D-035, D-043; en la iteración 2: D-051; en la iteración 3: m-09, F038; y en la revisión final: D-201)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.8, 3.15 y 3.17; HU-025, HU-030; RNF-021; D-019, D-021, D-029, D-035, D-043; documentación de Vercel (Cron Jobs, Functions), de Next.js (`after`) y precios de Supabase

## Contexto
- Vercel no tiene procesos permanentes. Las funciones tienen duración máxima de 300 s en Hobby (Fluid compute) y el cuerpo de petición máximo es 4,5 MB.
- Vercel Cron en Hobby: hasta 100 tareas por proyecto, como mínimo una vez al día y con precisión de hora (por ejemplo, `0 1 * * *` se ejecuta entre la 1:00 y la 1:59). En Pro, por minuto. La documentación indica que Cron Jobs será migrado en el futuro a "Schedules".
- grammY corta el manejo de una actualización a los 10 s por defecto y Telegram reenvía las actualizaciones que no recibieron respuesta a tiempo.
- Hay mensajes que se envían a terceros como efecto de una operación: alerta al prestador (HU-025), respuesta al visitante (HU-026), resultados de registro y revisión, avisos por revocación (D-019, D-029).
- Los datos se eliminan el 31 de enero de 2027 (D-021).

## Decisión
**Bandeja de salida (`notification_outbox`).**
- Cada mensaje a un tercero se inserta en `notification_outbox(recipient_telegram_user_id, template, payload, status, attempts, next_attempt_at)` dentro de la misma transacción de la operación que lo causa. Si la transacción falla, no hay mensaje; si el envío falla, la operación ya quedó registrada.
- Después de responder, `after()` de Next.js (estable desde 15.1; en Vercel usa `waitUntil`) envía los mensajes pendientes de esa operación. Un error de Telegram suma el intento y deja la fila `pending` con `next_attempt_at`; ninguna tarea la reintenta, porque la ruta `cron/outbox` no se construye (D-093, D-197, D-201).
- `payload` no contiene número de identidad. Las filas enviadas se borran a los pocos días en la tarea diaria; las de una persona que revoca se borran con su cuenta, salvo los avisos que su revocación genera para otros.
- Respuesta 403 de Telegram (la persona bloqueó el bot): se marca `failed` sin reintentos.

**Tareas diarias (`vercel.json` → `crons`), protegidas con `Authorization: Bearer ${CRON_SECRET}`:**
| Tarea | Horario (UTC) | Qué hace |
| --- | --- | --- |
| `GET /api/v1/internal/cron/maintenance` | `0 8 * * *` (3:00 a 3:59 Bogotá) | Borra de Blob los archivos que ninguna fila de `listing_photos` referencia (subidas no registradas, versiones `superseded` o `rejected` cuyas fotos no usa otra versión y fotos de fichas borradas por la eliminación), las subidas vencidas, los contadores de límites vencidos, los formularios del bot vencidos o abandonados y los `processed_updates` antiguos |
| `GET /api/v1/internal/cron/retention` | `0 5 * * *` (0:00 a 0:59 Bogotá) | Si la fecha en America/Bogota es igual o posterior a `app.retention_settings.deadline` (2027-01-31) y la eliminación aún no se ejecutó, la ejecuta una vez |

> Nota (D-201, revisión final H1): se retiró de esta tabla la tarea `GET /api/v1/internal/cron/outbox` (reintento de la bandeja de salida). No se construye, conforme a D-093 y D-197; el envío de la bandeja sigue siendo el único intento con `after()` descrito arriba.

**Eliminación del 31 de enero de 2027 (D-021, D-043, RNF-021).**

Alcance confirmado (D-043):
| Se borra | Tablas |
| --- | --- |
| Cuentas | `accounts` y, con ellas, `bot_sessions`, `rate_limit_counters` y `role_grants` (todos los permisos, también los de administradores autorizados que no aceptaron, porque contienen su ID de Telegram, D-037) |
| Consentimientos | `consent_events` (prueba de autorización y revocación, D-021) |
| Registros | `provider_registrations` (con el número de identidad cifrado) |
| Solicitudes | `information_requests`, `information_request_replies`, `information_request_status_events` |
| Auditoría | `audit_events`, `listing_status_events` (historial de todas las fichas, incluidos los atractivos), `notification_outbox` y `processed_updates` |
| Fichas de prestadores con sus fotos | `businesses`; `listings` de tipo `establishment` y `route_experience` con sus `listing_versions`, `listing_photos` y `photo_uploads`; sus archivos en Blob |

| Se conserva | Cómo queda |
| --- | --- |
| Municipios y listas cerradas | `municipalities`, `categories`, `experience_types`, `establishment_types`, con los responsables en nulo |
| Atractivos | `listings` de tipo `attraction` con sus versiones y fotos. Los responsables quedan en nulo (`ON DELETE SET NULL`) y se muestran como "Usuario eliminado" |
| Aviso de privacidad | `privacy_notice_versions` (texto público, sin datos personales) |
| Configuración | `retention_settings`, con la fecha de ejecución |

Procedimiento:
1. La función `app.purge_personal_data()` (`SECURITY DEFINER`, propiedad del rol de migraciones; `eje_app` solo tiene `EXECUTE`) comprueba dentro de la propia función que `now() AT TIME ZONE 'America/Bogota'` sea igual o posterior a `deadline` y que `executed_at` sea nulo. Si no se cumple, no hace nada.
2. En una sola transacción borra el alcance anterior en orden de dependencias y marca `retention_settings.executed_at`. Devuelve el número de filas borradas por tabla, sin datos personales.
3. Los archivos de Blob de las fichas borradas quedan sin referencia y los borra la tarea de mantenimiento. Esa tarea vuelve a intentarlo cada día si `del` falla. Por eso un fallo de Blob no deja datos de la base a medias.
4. Se ejecuta **una sola vez**. Si la tarea falla o Vercel no la lanza ese día, se ejecuta al día siguiente, porque la condición es "igual o posterior". Después de ejecutarse, no vuelve a borrar datos nuevos. El plazo para los datos recogidos después del 31 de enero de 2027 se decide antes de esa fecha; si el sistema sigue en uso, se publica una versión nueva del aviso con ese plazo (D-051), y la tarea se ajusta a él. No bloquea la entrega del 26 de noviembre de 2026.
5. La tarea de las 0:00 a 0:59 (precisión de Hobby) deja todo borrado dentro de la primera hora del 31 de enero (hora de Bogotá).

Verificación (RNF-021):
- Prueba de integración: con la base de pruebas sembrada con todas las tablas, se fija `deadline` en la fecha del día y se llama a la tarea con `CRON_SECRET`. Se verifica que el alcance de D-043 queda vacío, que lo conservado sigue igual y que una segunda ejecución no cambia nada.
- Prueba manual en el entorno de vista previa: el script `pnpm purge:dry-run` informa qué se borraría, sin borrar. `pnpm purge:run` ejecuta la función contra la base de desarrollo con una fecha simulada.
- Con Supabase Free (D-035) no hay copias de seguridad automáticas ni recuperación a un punto en el tiempo (página de precios de Supabase, consultada el 2026-11-14). Por eso la eliminación no deja copias accesibles al proyecto. Las copias internas del proveedor no están documentadas por proyecto.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Enviar los mensajes dentro de la transacción | Simple | Si Telegram tarda, la petición supera el tiempo del webhook y Telegram la reenvía |
| Cola externa (Vercel Queues, QStash) | Reintentos finos | Proveedor o producto fuera del stack fijo |
| `pg_cron` de Supabase | Precisión al minuto | Lógica repartida entre base y aplicación; no puede borrar fotos de Blob |
| Cron por minuto | Reintentos rápidos | No disponible en Hobby |

## Consecuencias
- Más fácil: operaciones y mensajes consistentes, sin procesos permanentes.
- Más difícil: un mensaje con error de Telegram no se reintenta; queda `pending` en la bandeja (riesgo aceptado en D-093). Construir el reintento sería una decisión nueva.
- La migración futura de Cron Jobs a "Schedules" anunciada por Vercel puede exigir cambiar la configuración, no el código.
- La eliminación la construye y la verifica F038 (prioridad 12, depende de F037), con `runRetentionJob` y `runMaintenanceJob`. Sus pasos coinciden con la "Verificación" de esta ADR: fecha límite en el día actual, alcance borrado, lo conservado intacto y segunda ejecución sin cambios.
- `PRINCIPAL_ADMIN_TELEGRAM_ID` es un dato personal guardado en las variables de Vercel, fuera de la base, y la función de eliminación no lo borra. La responsable debe quitarlo o cambiarlo a mano el 31 de enero de 2027 si el plazo lo exige.
