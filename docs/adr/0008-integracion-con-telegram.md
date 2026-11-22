# 0008. Integración con Telegram: bot con grammY por webhook, Mini App, modo de prueba y manejo de fallos

- **Estado:** Propuesta (revisada en la iteración 1 de preparación: D-035, D-039, D-042; y en la revisión final: D-201 y D-202)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.10, 3.16 y 3.17; D-002, D-035, D-039, D-042; HU-019 a HU-021, HU-024 a HU-027; Bot API 10.4 (9 de noviembre de 2026); documentación de grammY

## Contexto
Telegram es el canal principal (sección 3.10). El bot debe funcionar por webhook en Vercel. Límites verificados en la Bot API: fotos por URL hasta 5 MB y por subida directa hasta 10 MB; suma de ancho y alto de una foto hasta 10000 y proporción hasta 20; `sendMediaGroup` admite de 2 a 10 elementos; descarga con `getFile` hasta 20 MB; texto de mensaje hasta 4096 caracteres y leyenda hasta 1024; `callback_data` hasta 64 bytes.

## Decisión
**Proveedor y librerías.** Bot API de Telegram mediante grammY 1.x (versión vigente verificada: 1.46.0). Mini App con el script oficial `https://telegram.org/js/telegram-web-app.js`. Costo: la Bot API no tiene costo.

**Webhook.**
- Ruta `POST /api/v1/telegram/webhook` con `webhookCallback(bot, 'std/http', { secretToken })` (ADR 0003).
- **Primera respuesta sin aviso aceptado (D-039).** El adaptador busca la cuenta por `from.id` (solo lectura). Si no existe o no tiene la versión vigente, cualquier mensaje, comando o botón recibe B01, el aviso con "Acepto" y "No acepto" (y "Revocar mi autorización" si la cuenta aceptó una versión anterior, ADR 0005). No hay exploración, menús ni formularios antes de aceptar. En ese camino no se escribe nada: ni `processed_updates`, ni sesión, ni contador. Repetir el aviso no tiene efectos, y "Acepto" es idempotente (`INSERT ... ON CONFLICT`).
- Idempotencia de actualizaciones de cuentas existentes: antes de procesar, `INSERT INTO processed_updates(update_id) ON CONFLICT DO NOTHING`. Si ya existía, se responde 200 sin repetir efectos (Telegram reenvía si no recibe respuesta a tiempo). La tabla guarda solo `update_id` y la fecha, sin el ID de Telegram. En esta etapa ninguna tarea diaria la limpia (D-197; nota de D-202 en ADR 0007): sus filas se conservan hasta la eliminación del 31 de enero de 2027 (D-043).
- Límite por cuenta: las actualizaciones de una cuenta cuentan en `rate_limit_counters` (`bot_update`, ADR 0006). Si se supera, el bot responde que espere unos minutos y no procesa la acción.
- El trabajo lento (mensajes a terceros) se saca de la respuesta con la bandeja de salida (ADR 0007). Tiempo de grammY por defecto (10 s) con `onTimeout: 'throw'` (recomendación de grammY); la idempotencia evita duplicados si Telegram reintenta.
- Registro del webhook por script (`pnpm bot:set-webhook`) con `allowed_updates: ["message", "callback_query"]` y `drop_pending_updates` en el primer registro.

**Presentación de fichas en el bot (HU-020).**
- Fotos: `sendMediaGroup` con hasta 10 fotos (coincide con el límite de D-031) usando URLs prefirmadas de corta duración (ADR 0009); con una sola foto, `sendPhoto`. Tras el primer envío se guarda `telegram_file_id` de cada foto para reenviarla sin descargarla de nuevo.
- Respaldo si Telegram no puede descargar la URL: la función descarga la foto de Blob y la sube como archivo (hasta 10 MB).
- El texto de la ficha va en un mensaje aparte, con botones: "Ver ubicación" (botón `url` al enlace de Google Maps), "Solicitar información" (solo si `acceptsRequests`) y "Volver".
- Cabe en un mensaje (M-14): con los límites de D-042 (nombre 100, descripción 1500, horarios 300, contacto 200), el bloque principal ocupa como máximo 2100 caracteres de campos, más etiquetas, municipio, categoría y tipo. Queda por debajo de los 4096 caracteres de un mensaje. Los datos de guías, sin límite de producto todavía (Pendiente), tienen un máximo técnico de 4096 caracteres. Si el total supera 4096, el adaptador los envía en un segundo mensaje antes de los botones, sin cortar ningún campo. El orden lo fija una función pura con pruebas unitarias en el límite.
- Escape: los textos se envían sin `parse_mode` o escapados (ADR 0006), así que el conteo es el del texto plano.
- Listas con botones paginados; el estado de navegación (municipio, categoría) viaja en `callback_data` corto, para que "Volver" conserve la elección (F023).

**Mini App.** Se abre desde el botón de menú del bot y desde botones `web_app` en mensajes. Las pantallas de la Mini App están en `docs/03-arquitectura.md`.

**Modo de prueba sin efectos reales.**
- Pruebas automáticas: el bot se ejecuta con `bot.handleUpdate(updateFalso)` y un transformador de la API de grammY (`bot.api.config.use`) que intercepta todas las llamadas salientes y las guarda en memoria; ninguna llega a Telegram. Las notificaciones se prueban leyendo la bandeja de salida.
- `initData` de prueba firmados con un token de bot de prueba para la API y Playwright.
- Pruebas manuales: dos bots creados por la usuaria en BotFather (D-035). El de desarrollo se usa en local y en vista previa, y el de producción nunca se usa para pruebas.
- Desarrollo local: script `pnpm bot:dev` que usa *long polling* con el bot de desarrollo (solo en la máquina local, nunca en Vercel) o un túnel HTTPS hacia `next dev`.

**Fallos.**
| Fallo | Manejo |
| --- | --- |
| Telegram no responde o 5xx | La bandeja de salida registra el intento y deja el mensaje `pending`, sin reintento automático (D-093, D-201); el usuario ve el resultado de su operación |
| 429 de Telegram (límite de envío) | Se respeta `retry_after` y se reprograma |
| 403 (la persona bloqueó el bot) | Se marca fallido sin reintentos |
| Error en un manejador | Mensaje claro en español sin datos técnicos (HU-027); registro técnico sin datos personales |
| Actualización duplicada | Se ignora por `processed_updates` |

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Telegraf | Popular | El stack fijo nombra grammY |
| Long polling en producción | Sin URL pública | Requiere proceso permanente; Vercel no lo soporta |
| Enviar fotos siempre subiendo el archivo | No depende de que Telegram descargue la URL | Cada envío descarga de Blob dentro de la función; más tiempo y transferencia |

## Consecuencias
- Más fácil: pruebas deterministas del bot sin red; reenvío barato de fotos con `file_id`.
- Más difícil: el detalle de la ficha necesita una función de armado de mensajes con prueba de límite. Con D-042, el bloque principal siempre cabe en un mensaje.
- Telegram transporta y guarda mensajes en sus servidores, con su propia política (aviso, apartado 5).
