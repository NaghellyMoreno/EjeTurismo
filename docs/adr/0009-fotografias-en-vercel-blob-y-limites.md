# 0009. Fotografías en un almacén privado de Vercel Blob con subida directa por URL prefirmada; viabilidad de D-031

- **Estado:** Propuesta (límites fijados por D-042 y plan por D-035; revisada en la iteración 1 de preparación: M-11, m-05)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.3, 3.7 y 3.17; HU-017, HU-020; RNF-024; D-013, D-028, D-031, D-035, D-042; documentación oficial de Vercel Blob, Vercel Functions y Bot API

## Contexto
D-031 fija 10 fotos por ficha enviada a aprobación y un tope de 2 GB en total por ficha, y pide verificar la viabilidad con los límites de Vercel. El visitante solo debe ver las fotos de la versión publicada (HU-017 criterio 1).

Límites verificados (documentación oficial, consultada el 2026-11-14):
| Límite | Valor | Fuente |
| --- | --- | --- |
| Cuerpo de petición o respuesta de una función | 4,5 MB | Vercel Functions Limits |
| Tamaño máximo de un archivo en Blob | 5 TB (multiparte recomendada desde 100 MB) | Vercel Blob Pricing, Limits |
| Almacenamiento incluido en Hobby | 1 GB al mes (promedio mensual); 10 000 operaciones simples, 2 000 avanzadas, 10 GB de transferencia | Vercel Blob Pricing |
| Exceder el incluido en Hobby | No se cobra, pero Blob deja de estar accesible y hay que esperar 30 días | Vercel Blob Pricing |
| Límite de operaciones en Hobby | 1 200 simples y 900 avanzadas por minuto | Vercel Blob Pricing |
| Foto enviada por el bot por URL | 5 MB | Bot API, Sending files |
| Foto enviada por el bot subiendo el archivo | 10 MB; suma de ancho y alto hasta 10000; proporción hasta 20 | Bot API, sendPhoto |
| Fotos por álbum (`sendMediaGroup`) | 2 a 10 | Bot API |
| Región del almacén | Se elige al crearlo entre 19 regiones; no se puede cambiar | Vercel Blob |
| Privado o público | Se elige al crear el almacén; no se puede cambiar | Vercel Blob |

**Viabilidad de D-031.**
1. **10 fotos por ficha: viable.** No choca con ningún límite y coincide con el máximo de un álbum de Telegram.
2. **Subir fotos grandes: viable** solo con subida directa del navegador a Blob; la subida a través de una función queda limitada a 4,5 MB por petición.
3. **2 GB por ficha: técnicamente aplicable, pero no alcanzable en la práctica ni sostenible en Hobby.**
   - El bot solo puede mostrar fotos de hasta 5 MB por URL o 10 MB subiendo el archivo. Con 10 fotos, una ficha que el visitante pueda ver ocupa como máximo 50 a 100 MB; nunca 2 GB.
   - En Hobby, todo el almacén tiene 1 GB incluido. Una sola ficha de 2 GB lo supera, y al superarlo Blob queda inaccesible 30 días: el bot dejaría de mostrar todas las fotos durante la demostración.
   - En Pro sería viable con costo por uso (precio regional por GB al mes).
   - Conclusión: el tope de 2 GB se puede programar como regla (se rechaza la foto que haga superar 2 GB), pero quien realmente limita es el tamaño por foto y el espacio total del plan.

**Límites vigentes (D-042, D-035, D-031):**
| Límite | Valor | Dónde se aplica |
| --- | --- | --- |
| Fotos por versión de ficha | 10 (D-031) | Servicio al emitir la URL; disparador con bloqueo al registrar |
| Tamaño por foto | 5 MB = 5 000 000 bytes (`PHOTO_MAX_BYTES`, D-042) | URL firmada restringida al tamaño; `head` al registrar |
| Total por ficha | 2 GB = 2 147 483 648 bytes (D-031) | Servicio y disparador (suma de `size_bytes` de la versión) |
| Cuota global del almacén | 900 MB = 900 000 000 bytes en producción (`BLOB_STORAGE_QUOTA_BYTES`, D-042) | Servicio, sumando fotos vivas y subidas en curso, con bloqueo consultivo global |
| Plan | Vercel Hobby (D-035) | 1 GB incluido; la cuota de 900 MB evita superarlo |

Interpretación de las unidades: "MB" se aplica en unidades decimales, de modo que 5 MB son 5 000 000 bytes y 900 MB son 900 000 000 bytes, que es la cifra recomendada y aprobada. El valor decimal queda por debajo del límite de 5 MB de la Bot API para fotos por URL, se interprete como se interprete. Ambos valores son configurables.

Con 5 MB por foto y 10 fotos, una versión ocupa como máximo 50 MB. El tope de 2 GB por ficha sigue programado (D-031), pero con estos límites nunca se alcanza: es una regla de respaldo, no un límite que se pueda ejercer subiendo fotos reales.

**Cómo se verifica cada límite (hallazgo M-11; F020, paso 4):**
- 10 fotos: subiendo 11 fotos reales (F020, paso 3).
- 5 MB por foto: subiendo una foto de más de 5 MB. Se rechaza en `createPhotoUpload` (422 `validation_failed`, campo `sizeBytes`) y, si el cliente declara un tamaño falso, en `registerPhoto` por el tamaño real (422 `photo_too_large`).
- Cuota global: en el entorno de vista previa o de pruebas, `BLOB_STORAGE_QUOTA_BYTES` se fija en un valor bajo (por ejemplo, el tamaño de 3 fotos de prueba) para que QA llegue a la cuota con pocas fotos y verifique 409 `storage_quota_exceeded`. La variable es por entorno y producción conserva 900 000 000.
- 2 GB por ficha: no se alcanza con fotos reales. Lo verifica una prueba de integración que inserta filas de `listing_photos` con `size_bytes` sintéticos contra el disparador, y una prueba del servicio con el almacenamiento simulado que declara tamaños grandes. El paso 4 de F020 debe cambiar a estas verificaciones (cambio para el product-manager).

## Decisión
**Versiones editables para fotos (m-05).** Se pueden agregar o quitar fotos en dos casos: (a) la versión `draft` de una ficha de prestador, por el dueño del negocio; (b) la versión `published` de un atractivo, por un administrador, porque los atractivos no tienen borrador ni validación (D-005; F020, paso 7). En cualquier otro caso, la operación responde 409 `invalid_state_transition`. El disparador de `listing_photos` aplica la misma regla.

**Almacén.** Un almacén **privado** de Vercel Blob por entorno (producción y desarrollo o vista previa), en `gru1`, São Paulo (D-035; ADR 0010). Privado porque las fotos de borradores, pendientes y rechazadas no deben ser accesibles para el visitante, y porque la eliminación por revocación o por plazo debe ser efectiva. Requiere `@vercel/blob` 2.3 o superior (versión vigente verificada: 2.9.0).

**Ruta de cada foto.** `listings/{listingId}/{uploadId}.{jpg|png}`. Las fotos son inmutables: nunca se sobrescriben.

**Subida (Mini App, prestador o administrador):**
1. `POST /api/v1/managed-listings/{listingId}/versions/{versionId}/photo-uploads` con `fileName`, `contentType` y `sizeBytes`. El servicio verifica actor, propiedad de la ficha y que la versión sea editable (borrador del prestador o versión publicada de un atractivo del administrador); bloquea la versión y comprueba: menos de 10 fotos, tipo permitido, tamaño por foto, total de la versión más el archivo hasta 2 GB y cuota global del almacén. Registra `photo_uploads(id, version_id, pathname, declared_size, expires_at)` y devuelve una URL prefirmada `PUT` creada con `issueSignedToken` + `presignUrl`, restringida a esa ruta, al tipo y al tamaño declarado, con vigencia corta.
2. La Mini App sube el archivo directamente a Blob con esa URL (no pasa por la función, no cuenta para los 4,5 MB).
3. `POST /api/v1/managed-listings/{listingId}/versions/{versionId}/photos` con `uploadId`. El servicio lee los metadatos (`head`) y los primeros bytes del archivo para confirmar que es JPEG o PNG por su firma, y en una transacción con bloqueo vuelve a comprobar los límites e inserta `listing_photos`. Si algo falla, borra el archivo de Blob y responde con el error.
- No se usa `onUploadCompleted` porque Vercel Blob no puede llamarlo en `localhost` y porque el paso 3 cumple la misma función con control propio.

**Lectura.**
- Mini App: las respuestas de fichas gestionadas incluyen URLs prefirmadas `GET` de corta vigencia para las fotos de las versiones que el actor puede ver.
- Bot: el servicio público entrega URLs prefirmadas `GET` solo para fotos de versiones publicadas; Telegram las descarga (ADR 0008).
- El token de firma (`issueSignedToken`) se reutiliza hasta poco antes de su vencimiento para no llamar a la API de control en cada petición.

**Copias entre versiones.** Al crear un borrador desde la versión publicada, `listing_photos` se copia apuntando al mismo archivo; el archivo solo se borra cuando ninguna versión viva lo usa (tarea diaria, ADR 0007).

**Cuota global.** `BLOB_STORAGE_QUOTA_BYTES` (900 000 000 en producción, D-042) se compara con la suma de `size_bytes` de las fotos vivas y de las subidas en curso antes de emitir una URL de subida. Los archivos que referencian varias versiones se cuentan una sola vez, por `blob_pathname`.

**Tipos de archivo.** JPEG y PNG (Inferido: son los formatos que Telegram acepta como foto sin conversión; valor por defecto pendiente de aprobación). Un archivo que no es imagen se rechaza en el paso 1 por tipo y en el paso 3 por firma (HU-017 criterio 2).

**CSP.** El dominio al que apunta la URL prefirmada `PUT` debe estar en `connect-src`; se fija al implementar, con el dominio que devuelva `presignUrl`.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Almacén público con nombres aleatorios | Sin firmas; entrega directa por CDN | Una URL filtrada de un borrador queda accesible para cualquiera; no se puede cambiar a privado después |
| Subida a través de una función (`put` en servidor) | Un solo paso | Máximo 4,5 MB por petición; cobra transferencia de entrada |
| `handleUpload` con token de cliente | Ejemplo oficial | Necesita el token de lectura y escritura de larga duración y el protocolo propio del SDK fuera de `api/openapi.yaml` |
| Recibir fotos por el chat del bot | Natural en Telegram | Telegram las comprime; el formulario de fichas está en la Mini App (D-002) |

## Consecuencias
- Más fácil: control total de límites y permisos en el backend; ningún archivo privado es público.
- Más difícil: las URLs prefirmadas caducan, así que la Mini App debe pedir de nuevo la ficha si una imagen falla por vencimiento.
- Riesgo: que el cliente de descarga de Telegram no acepte una URL prefirmada; el respaldo es subir el archivo desde la función (ADR 0008).
- El paso 4 de F020 ("acercarse a 2 GB") no se puede ejecutar con fotos reales. Se reemplaza por las verificaciones descritas arriba (cambio para el product-manager).
