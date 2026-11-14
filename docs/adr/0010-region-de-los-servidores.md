# 0010. Región de los servidores de Supabase, Vercel y Vercel Blob (tarea D-022)

- **Estado:** Aceptada (regiones, D-035; el aviso menciona la transferencia internacional, D-034)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.15 y 3.17; RNF-023; D-022, D-034, D-035; `docs/05-aviso-privacidad.md` (apartado 5); documentación oficial de Supabase (Regions) y Vercel (Regions, Functions Limits, Vercel Blob), consultada el 2026-11-14

## Contexto
D-022 pide confirmar dónde están los servidores antes de que la usuaria decida si el aviso menciona transferencia de datos fuera de Colombia. El contexto no permite citar normas distintas de la Ley 1581 de 2012 sin confirmación (sección 3.15); este ADR no interpreta normas.

## Hallazgos
| Proveedor | Qué guarda o procesa | Cómo se fija la región | Región por defecto | Región más cercana a Colombia | ¿Hay región en Colombia? |
| --- | --- | --- | --- | --- | --- |
| Supabase (PostgreSQL) | Toda la base de datos: cuentas, consentimientos, registros, números de identidad cifrados, fichas, solicitudes | Cada proyecto se despliega en una región primaria donde se guardan sus datos; se elige al crear el proyecto | Las "regiones generales" eligen por área (Américas: este de EE. UU., Virginia del Norte) | `sa-east-1`, São Paulo (Brasil), única región de Sudamérica | No |
| Vercel Functions | Procesa cada petición del bot y de la Mini App (datos en tránsito y en memoria) | Configuración del proyecto (`regions` en `vercel.json` o ajustes); Hobby usa una sola región | `iad1`, Washington D. C. (EE. UU.) | `gru1`, São Paulo (Brasil) | No |
| Vercel Blob | Fotografías de las fichas | Se elige al crear el almacén; no se puede cambiar después | Se elige al crearlo (19 regiones) | `gru1`, São Paulo (Brasil) | No |
| CDN de Vercel | Copias en caché de archivos de Blob (públicos y privados, hasta un mes por defecto) y de respuestas | Red global de puntos de presencia | Global | — | La documentación no lista ubicaciones por país en este nivel |
| Telegram | Transporta los mensajes del bot y de la Mini App | Lo decide Telegram | No verificado en esta tarea | — | No verificado |

Datos no verificados: la región real de un proyecto de Supabase o de un almacén de Blob ya creados (si existen) solo se ve en su panel; dónde guarda Vercel los registros técnicos de las funciones.

## Conclusión informativa
- Con cualquier región disponible, la base de datos, las fotografías y el procesamiento quedan **fuera de Colombia** (Brasil o Estados Unidos). Ningún proveedor del stack fijo ofrece región en Colombia.
- La caché del CDN de Vercel puede guardar copias de las fotos en otros países, aunque el almacén esté en São Paulo.
- Decidir si el aviso menciona transferencia internacional, y con qué redacción, le corresponde a la usuaria (D-022).

## Decisión (D-035)
- Los dos proyectos de Supabase (desarrollo y producción) se crean en `sa-east-1`, São Paulo. Las funciones de Vercel se fijan en `gru1`, São Paulo (`regions: ["gru1"]` en `vercel.json`), y los dos almacenes de Blob se crean en `gru1`. Motivo técnico: menor latencia entre funciones y base de datos (Vercel recomienda ejecutar las funciones en la región de la base o lo más cerca posible) y entre Colombia y los servidores.
- Si el proyecto de Supabase ya existe en otra región, la región no se cambia en sitio; habría que crear uno nuevo. Lo mismo vale para un almacén de Blob.
- Con esta configuración, los datos se guardan y procesan en Brasil, y la CDN de Vercel puede guardar copias en caché en otros países. El aviso aprobado menciona la transferencia internacional (D-034). Que el texto del documento del aviso quede actualizado le corresponde al product-manager.

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Todo en `gru1` / `sa-east-1` (recomendada) | Menor latencia hacia Colombia; misma región para funciones, base y fotos | Precio regional de Blob y transferencia puede ser mayor que en `iad1` (irrelevante dentro del incluido de Hobby) |
| Todo en `iad1` / `us-east-1` | Región por defecto; precios de referencia | Mayor latencia desde Colombia |
| Funciones en `iad1` y base en `sa-east-1` | Ninguna configuración | Cada consulta cruza continentes; webhook más lento |

## Consecuencias
- Al crear cada servicio, la responsable elige la región indicada. No se puede corregir después sin recrear el servicio.
- Supabase Free admite dos proyectos activos, justo los de desarrollo y producción (página de precios de Supabase, consultada el 2026-11-14).
- F001 y F036 ya no dependen de esta decisión. Siguen dependiendo de que el documento del aviso refleje el texto aprobado (D-034).
