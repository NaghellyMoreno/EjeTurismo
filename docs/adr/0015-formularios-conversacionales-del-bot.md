# 0015. Formularios conversacionales del bot como máquinas de estado con sesión en PostgreSQL

- **Estado:** Propuesta (revisada en la iteración 1 de preparación: hallazgo M-06, D-039; y en la iteración 2: D-046)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.10, 3.12 y 3.15; HU-002, HU-024, HU-026, HU-027; D-008, D-039, D-046; documentación de grammY (sesiones y plugin de conversaciones)

## Contexto
- El bot lleva formularios (registro de prestador, solicitud, respuesta, motivo de rechazo, autorizar administrador). En serverless no hay memoria entre actualizaciones, así que el estado del formulario debe guardarse fuera.
- Si no se acepta el aviso no se guarda ningún dato (D-008), ni siquiera el estado de un formulario.
- El usuario puede cancelar en cualquier paso sin que se guarde nada (HU-027).
- El plugin de conversaciones de grammY 2.x vuelve a ejecutar la función desde el inicio en cada actualización y exige envolver efectos en `conversation.external`; su documentación desaconseja claves de almacenamiento propias en serverless por condiciones de carrera.

## Decisión
- Sesión de grammY (incluida en el núcleo) con un adaptador de almacenamiento propio sobre `app.bot_sessions(account_id PK → accounts ON DELETE CASCADE, data jsonb, updated_at)`.
- La sesión solo se activa si existe la cuenta con la versión vigente del aviso. Antes de aceptar, el bot responde sin estado: cualquier mensaje o botón recibe el aviso (D-039), y el aviso y sus botones no necesitan sesión.
- Cada formulario es una máquina de estado explícita en `src/bot/forms/`: `{ form, step, draft, startedAt, expiresAt }`. Cada paso valida con el esquema de dominio; un error repite solo ese paso (HU-027 criterio 2).
- El borrador del formulario vive solo en la sesión; nada se escribe en tablas de negocio hasta la confirmación final, que llama al servicio con `confirmed: true`.
- **Registro de prestador (D-046).** Pasos: tipo de documento, número y confirmación. El paso del tipo ofrece cuatro botones (CC, CE, PPT y PA, con los nombres de HU-002, criterio 4, aprobados en D-055). Si la persona escribe texto en ese paso, el bot lo acepta solo si coincide con una de las cuatro siglas, sin distinguir mayúsculas (Confirmado, D-055); si no, explica que solo se aceptan esos cuatro tipos y vuelve a pedir el tipo (F002, paso 2). El tipo elegido queda en `draft` como código. El número se valida con `validateIdentityNumber` (ADR 0005).
- **Datos sensibles en la sesión (hallazgo M-06).** El número de identidad del registro de prestador nunca se guarda en claro en `draft`. El manejador del paso lo valida en memoria y guarda solo `draft.sealedIdentity`, cifrado con AES-256-GCM (`IDENTITY_ENCRYPTION_KEY`, IV aleatorio y datos asociados `account_id` + `provider_registration`), con `expiresAt` corto. Al pulsar "Confirmar", el servicio lo descifra en memoria, cifra y calcula el hash definitivos en `provider_registrations` y borra el campo de la sesión en la misma transacción. Si venció, el bot pide el número de nuevo. La vigencia la fija `BOT_SENSITIVE_DRAFT_TTL_SECONDS`, un parámetro técnico con valor por defecto de 600 s (Inferido, configurable).
- "Cancelar" (botón y comando `/cancelar`) borra `draft`, incluido el número sellado, responde "No se guardó nada" y vuelve al menú (HU-027 criterio 1). La tarea diaria de mantenimiento borra los formularios vencidos o abandonados.
- Un mensaje de texto cuando el paso espera un botón recibe una indicación clara (F028).
- Concurrencia: la escritura de la sesión compara `updated_at` (bloqueo optimista); si dos actualizaciones del mismo usuario chocan, la segunda pide repetir el paso.
- Los textos visibles están en `src/bot/texts/es.ts`; ningún texto incluye datos técnicos ni el número de identidad.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Plugin de conversaciones de grammY 2.x | Código lineal y legible | Reejecución en cada actualización; efectos a envolver; datos que crecen con cada paso; advertencias para serverless |
| Estado codificado solo en `callback_data` | Sin almacenamiento | 64 bytes no alcanzan para textos libres (mensaje, motivo) |
| ForceReply sin estado | Sin almacenamiento | No permite formularios de varios pasos ni cancelación fiable |

## Consecuencias
- Más fácil: pasos deterministas y fáciles de probar con actualizaciones falsas.
- Más difícil: más código explícito por formulario.
- La sesión es dato personal temporal: se borra al revocar (cascada) y en la eliminación del 31 de enero de 2027.
- Ni siquiera un volcado de `bot_sessions` expone un número de identidad sin la clave de cifrado.
