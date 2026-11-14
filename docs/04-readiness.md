# Revisión de preparación para la implementación

- **Fecha:** 2026-11-14
- **Iteración:** 3 (máximo 3)
- **Veredicto:** PASS

## Resumen
Los cinco hallazgos mayores de la iteración 2 están resueltos. D-046, D-054 y D-055 fijan el documento de identidad, y F002 ya tiene criterio de aprobación en QA. D-047 cierra la contradicción entre D-038 y D-044. D-048, D-052 y D-053 meten "Sabores de Caldas" en el directorio gastronómico. F010 ya no choca con la semilla, y D-057 aprueba el texto del aviso 2.5. D-046 a D-059 están aplicadas sin contradicción en la arquitectura, el contrato (0.3.1), las ADR, el aviso, los requisitos y `feature_list.json`. Ningún documento contradice el contexto, nada fuera de alcance se coló, y cada invariante tiene RNF y mecanismo. Quedan 11 hallazgos menores. Ninguno bloquea la construcción ni el cierre en QA de las funcionalidades de prioridad 1.

Nota de numeración: la arquitectura renumeró sus Pendientes (antiguo 2 → 1, 3 → 2, 5 → 3, 6 → 4, 7 → 5 y lo que queda del 8 → 6). Este informe usa solo la numeración nueva de `docs/03-arquitectura.md`, "Pendientes". Las referencias del informe de la iteración 2 se corrigieron así: m-08 "Pendientes 2, 3, 5, 6, 7 y 8" pasa a "1, 2, 3, 4, 5 y 6"; M-14 "Pendiente 6" pasa a "Pendiente 4"; F004 "Pendiente 2" pasa a "Pendiente 1"; F038 "Pendiente 5" pasa a "Pendiente 3". El "Pendiente 4" que citaba M-16 se retiró en la iteración 2 (D-048), y el antiguo Pendiente 1 se retiró con D-052.

## Estado de los hallazgos de la iteración 2
| ID | Estado | Evidencia |
| --- | --- | --- |
| M-01 | Resuelto | D-046, D-054, D-055. `docs/02-requisitos.md`, HU-002, criterios 3 y 4. `feature_list.json`, F002, pasos 2, 6, 7 y 8. `api/openapi.yaml`, `createProviderRegistration`, `IdentityDocumentType`, `ProviderRegistrationCreate`. `docs/adr/0005-datos-personales-consentimiento-y-revocacion.md`, "Documento de identidad: tipo y número". `docs/adr/0015-formularios-conversacionales-del-bot.md`, "Registro de prestador". `docs/03-arquitectura.md`, "Entidades" (`provider_registrations`, enum y hash por tipo y número). El aviso, apartado 2, menciona el tipo (D-056) |
| M-15 | Resuelto | D-047 confirma D-038. `docs/03-arquitectura.md`, "Riesgos técnicos" (última fila) y "Relaciones clave". `docs/01-brief.md`, "Resueltas", 23 |
| M-16 | Resuelto | D-048, D-052, D-053. `docs/adr/0011-datos-semilla.md`, "Decisión" y "Tipo de experiencia gastronómica". `docs/adr/0004-modelo-de-fichas-versiones-y-negocios.md`, "Directorio gastronómico". `docs/03-arquitectura.md`, "Entidades" (`experience_types.is_gastronomic`) y B18. `api/openapi.yaml`, `listPublishedListings` (`gastronomic=true`). `feature_list.json`, F017, pasos 5 y 6. HU-011, criterios 3 a 5. D-058 resuelve la dependencia de F017 respecto de F018 |
| M-17 | Resuelto | `feature_list.json`, F010, pasos 1 y 3: verifica los tres municipios de la semilla, crea uno de prueba y espera el rechazo de "Manizales" como duplicado. HU-007, criterio 4 |
| M-18 | Resuelto | D-057. `docs/05-aviso-privacidad.md`, apartado 2.5 y Pendiente 4 (resuelto). `feature_list.json`, F037, paso 7. HU-030, criterio 8. ADR 0005, "Aviso y aceptación" (plantilla en `src/bot/texts/es.ts`) |
| m-08 | Parcial, sigue menor | D-055 cubre los valores del documento de identidad, D-051 fija el criterio del Pendiente 3 y D-059 deja el resto del Pendiente 6 como Inferido no bloqueante. Siguen abiertos los Pendientes 1, 2, 4, 5 y 6 de la arquitectura (ver m-08 abajo) |
| m-09 | Resuelto | `docs/03-arquitectura.md`: el encabezado dice "35 funcionalidades", "Tareas programadas" cita F038 y "Trazabilidad" tiene la fila de F038. `docs/adr/0007-tareas-programadas-y-en-segundo-plano.md`, "Consecuencias" |
| m-10 | No resuelto (menor) | Ver m-10 abajo |
| m-11 | No resuelto (menor) | Ver m-11 abajo |
| m-12 | No resuelto (menor) | Ver m-12 abajo |
| m-13 | No resuelto (menor) | Ver m-13 abajo |
| m-14 | No resuelto (menor) | Ver m-14 abajo |
| m-15 | No resuelto (menor) | Ver m-15 abajo |
| m-16 | No resuelto (menor) | Ver m-16 abajo |
| m-17 | Resuelto | D-050. `docs/05-aviso-privacidad.md`, encabezado del Texto 1 ("versión 2026-11-v3. Vigente desde [fecha de publicación en producción]") y Pendiente 5 (resuelto). `feature_list.json`, F001, paso 5. ADR 0005, "Aviso y aceptación" |

Los hallazgos de la iteración 1 quedaron cerrados en la iteración 2, salvo los que siguieron como M-01, m-08 y siguientes, que se tratan arriba.

## Hallazgos
| ID | Severidad | Archivo y sección | Problema | Responsable |
| --- | --- | --- | --- | --- |
| m-08 | Menor | `docs/03-arquitectura.md`, "Pendientes", 1, 2, 4, 5 y 6 | Estos valores por defecto siguen Inferidos y sin aprobar: `role_conflict` al autorizar como administrador a un prestador (1); "Revocar mi autorización" en B01 y M01 (2); 4096 caracteres en los campos que D-042 no cubre (4); semillas sin categorías ni otros tipos de experiencia (5); y la lista de valores técnicos (6, que D-059 declara no bloqueante). Ningún paso de F004 prueba el 1. El Pendiente 3 no bloquea la entrega, pero hay que decidirlo antes del 31 de enero de 2027 (D-051), porque después de esa fecha el aviso (apartado 6) ya no describiría lo que hace el sistema | usuaria (sin pregunta nueva: las rondas de la fase 3 se agotaron) |
| m-10 | Menor | `docs/02-requisitos.md`, HU-005, criterio 6, y "Pendientes" (tercera viñeta); `feature_list.json`, F006, paso 7; `docs/01-brief.md`, "Supuestos y riesgos" (fila de "Revocar rol" sobre el administrador principal) y "Sin respuesta tras la ronda 3", 21; frente a `docs/adr/0003-autenticacion-sesiones-roles-y-autorizacion.md`, "Revocar rol", `docs/03-arquitectura.md`, "Autenticación, roles y autorización", y `api/openapi.yaml`, `revokeRole` | La arquitectura y el contrato dicen que la protección del administrador principal es una "regla aprobada en D-044". Los requisitos, F006 y el brief la siguen marcando "Inferida, pregunta 21 sin respuesta". Lo mismo pasa con otras reglas que la arquitectura cita como aprobadas en D-044, como el bloqueo de edición en pendiente (F013, paso 6), la transición rechazada a pendiente (F014, paso 5), los enlaces que no son de Maps (F021, paso 1) y cerrada a nueva (F032, paso 5). QA no sabría si esos pasos son reglas o supuestos. El comportamiento no cambia | orchestrator (confirma qué incluía el antiguo Pendiente 22); product-manager (marcas) |
| m-11 | Menor | `docs/01-brief.md`, "Nota para el orquestador"; "Supuestos y riesgos" (filas de varios negocios y de "Revocar rol" a un prestador); "Tareas del architect y pendientes de la usuaria" (filas D-052/D-053, D-054/D-055 y D-058) | La nota dice que F001 y F002 citan D-033 y que F006 marca D-043 como Pendiente; `feature_list.json` ya no lo hace. La fila de varios negocios da por Pendiente la asociación entre ficha y negocio, que la ADR 0004 resuelve (una ficha por negocio, Inferido). Las tres tareas del architect siguen "Pendiente (verificar)", aunque `docs/03-arquitectura.md`, la ADR 0005 y la ADR 0011 ya las aplican | product-manager |
| m-12 | Menor | `feature_list.json`, F011; `docs/02-requisitos.md`, HU-008 y HU-010, criterio 6 | Ningún paso verifica crear o editar tipos de establecimiento (D-040, D-041), ni que un tipo nuevo creado en M11 quede fuera del directorio gastronómico (`isGastronomic` falso), aunque los endpoints y la pantalla M11 existen | product-manager |
| m-13 | Menor | `feature_list.json`, F020, pasos 5 y 6 | El paso 5 quita una de las 10 fotos, y el paso 6 envía "la ficha con 10 fotos". La secuencia no cuadra | product-manager |
| m-14 | Menor | `feature_list.json`, F006, paso 8, y F035, paso 6; `docs/adr/0003-autenticacion-sesiones-roles-y-autorizacion.md`, "Revocar rol" | El administrador principal siempre existe y no se puede revocar. Por eso la única forma de que haya "un solo administrador" es que sea el principal, y entonces el error es `principal_admin_protected`. Con los pasos actuales, `last_admin_protected` no se alcanza. Falta decir cómo se prepara ese escenario en pruebas (por ejemplo, sin `PRINCIPAL_ADMIN_TELEGRAM_ID` en la base de pruebas), o aceptar que lo cubre una prueba de integración | architect (escenario); product-manager (pasos) |
| m-15 | Menor | `docs/adr/0014-herramientas-migraciones-y-pruebas.md`, "Estado" | Dice "Propuesta", pero D-044 la aprobó y `docs/03-arquitectura.md`, "Herramientas y comandos", la da por aprobada | architect |
| m-16 | Menor | `docs/adr/0009-fotografias-en-vercel-blob-y-limites.md`, "Límites vigentes", "Verificación" y "Consecuencias" | La ADR mezcla unidades: MB en decimal (5 000 000 bytes) y 2 GB en binario (2 147 483 648 bytes). Además, dos frases todavía piden cambiar el paso 4 de F020, que ya está cambiado | architect |
| m-18 (nuevo) | Menor | `docs/02-requisitos.md`, HU-003, criterio 1, y RNF-008/RNF-009; `feature_list.json`, F003, paso 1, y F027; frente a `api/openapi.yaml`, `AdminProviderRegistration`, y `docs/03-arquitectura.md`, B07 y "Matriz de permisos" | Con D-046, el administrador ve el tipo y el número de documento (B07 y el contrato). Pero HU-003, criterio 1, y F003, paso 1, solo verifican el número. La arquitectura oculta el tipo a visitantes y prestadores, y el logger lo redacta (riesgo de PPT), pero F027 solo verifica el número. QA no comprobaría que el tipo se ve ni que no se filtra | product-manager |
| m-19 (nuevo) | Menor | `feature_list.json`, F017, paso 6; `docs/02-requisitos.md`, HU-011, criterio 5 | El criterio 5 (Confirmado) excluye del directorio la ficha de establecimiento sin tipo. El tipo es opcional (D-040), pero el paso 6 solo prueba un hotel y una experiencia no gastronómica | product-manager |
| m-20 (nuevo) | Menor | `docs/adr/0005-datos-personales-consentimiento-y-revocacion.md`, "Aviso y aceptación" (fecha de vigencia); `docs/03-arquitectura.md`, "Pendientes" y encabezado | La interfaz reemplaza el marcador "[fecha de publicación en producción]" por `published_at`. La ADR lo marca como Inferido, pero no está en la lista de Pendientes de la arquitectura. Además, el Pendiente 6 no cita D-059, y el encabezado dice "D-001 a D-058" | architect |

Conteo: 0 críticos, 0 mayores y 11 menores.

## Verificaciones con resultado favorable
- **Cobertura:** las 35 funcionalidades tienen pasos verificables y aparecen en "Trazabilidad" de `docs/02-requisitos.md` y de `docs/03-arquitectura.md`. HU-013, HU-022, HU-023 y HU-029 quedan fuera por D-030. Las prioridades de F017 (7) y F018 (6) y la dependencia F017 → F018 coinciden con D-058.
- **Contrato:** las 48 operaciones de `api/openapi.yaml` (0.3.1, sin cambios de operaciones respecto de 0.3.0) declaran `x-roles` y usan `Problem`. Cada una sirve a una funcionalidad: `receiveTelegramUpdate` al bot, `runOutboxRetryJob` a F031, F032 y F037, y `runMaintenanceJob` y `runRetentionJob` a F038. Ninguna funcionalidad depende de un endpoint inexistente. Solo la vista de administrador expone el tipo y el número de documento (`AdminProviderRegistration`); `OwnProviderRegistration` y las vistas públicas no los incluyen.
- **Invariantes 1 a 8:** cada uno tiene RNF (RNF-001 a RNF-010) y mecanismo en el servicio, la API y la base de datos (`docs/03-arquitectura.md`, "Mecanismo de cada invariante en el backend"). Para el invariante 4, D-038 y D-047 se aplican con disparadores en `provider_registrations` y `role_grants`.
- **Seguridad del contexto (sección 3.16):** `initData` con HMAC y vigencia, secreto del webhook con fail closed, esquema `app` fuera de la Data API y RLS. El número va cifrado y sellado, y el tipo de documento es un enum visible solo para administradores y redactado en el logger. Los contadores solo cuentan cuentas (`docs/03-arquitectura.md`, "Seguridad").
- **Contexto:** la sección 3.4 (restaurantes, cafés y experiencias gastronómicas) se cumple con D-040, D-048 y D-052. La sección 2.3 (registro con número de identidad) se cumple con D-046. Nada de la sección 3.14 se coló: sin cupos, pagos ni confirmación automática, y Google Maps es solo un enlace (ADR 0016).
- **Publicación:** Vercel Hobby en `gru1`, webhook, sin disco, Supabase Free en `sa-east-1` y Blob privado (D-035). Los crons son diarios. La semilla de referencia es igual en todos los entornos (ADR 0011; D-053 sin efecto tras D-052).
- **Decisiones D-046 a D-059:** reflejadas sin contradicción. Ninguna decisión de stack queda sin confirmar (D-035, D-044).
- **Guía (readiness-reviewer):** cada historia cita su sección del contexto. Hay reglas de separación por negocio, validación del prestador, duplicados (D-003, D-054), errores y cancelaciones (F028, F013). Ningún requisito exige reservas, pagos ni integraciones.

## Matriz de trazabilidad
| Funcionalidad | Historias | Endpoints | Pantallas o comandos | Estado |
| --- | --- | --- | --- | --- |
| F001 | HU-001 | `getCurrentPrivacyNotice`, `acceptPrivacyNotice`, `getMe` | B01, B02 | Lista (m-20) |
| F002 | HU-002 | `createProviderRegistration`, `getMyProviderRegistration` | B04, B05, B21 | Lista |
| F003 | HU-003 | `listProviderRegistrations`, `approveProviderRegistration`, `rejectProviderRegistration` | B06, B07, B20 | Lista (m-18) |
| F004 | HU-004 | `authorizeAdministrator`, `listRoleGrants`, `getMe` | B02, B06, B08 | Lista (m-08, Pendiente 1) |
| F005 | HU-006 | `getMe`, `createProviderRegistration` (403) | B02, B06, B12, M02 | Lista |
| F006 | HU-005 | `listRoleGrants`, `revokeRole` | B09 | Lista (m-10, m-14) |
| F007 | HU-003, HU-006 | Operaciones `provider` y `admin` (401 y 403) | B02 | Lista |
| F008 | HU-004, HU-014 | `authorizeAdministrator`, `createMunicipality`, `createCategory`, `approveListingVersion` | B12, M02 | Lista |
| F009 | HU-006 | Todas las de `telegramInitData` | M01 a M12 | Lista |
| F028 | HU-027 | `createProviderRegistration` | B04, B21 | Lista |
| F034 | HU-030 | `revokeMyAuthorization` | B01, B02, B03 | Lista (m-08, Pendiente 2) |
| F035 | HU-030 | `revokeMyAuthorization` | B03 | Lista (m-14) |
| F036 | HU-001, HU-030 | `getCurrentPrivacyNotice`, `acceptPrivacyNotice`, `getMe`, `revokeMyAuthorization` | M01, M02, M03 | Lista |
| F010 | HU-007 | `listMunicipalities`, `createMunicipality`, `updateMunicipality` | M10, B15 | Lista |
| F011 | HU-008 | `list/create/update` de categorías, tipos de experiencia y tipos de establecimiento | M11, M05 | Lista (m-12) |
| F012 | HU-009 | `createListing` (`attraction`), `listPublishedListings` | M09, B15 | Lista |
| F013 | HU-010 | `createListing`, `saveListingDraft`, `submitListingForReview`, `listManagedListings`, `getManagedListing` | M04, M05, M07, M08, M12, B12 | Lista (m-10) |
| F014 | HU-014, HU-015 | `listPendingReviews`, `getReview`, `approveListingVersion`, `rejectListingVersion` | B10, B12, B20, M08 | Lista (m-10) |
| F015 | HU-016 | `saveListingDraft`, `submitListingForReview`, `getReview`, `approveListingVersion`, `rejectListingVersion`, `getPublishedListing` | M05, M08, B10, B16 | Lista |
| F016 | HU-010 | `listManagedListings`, `getManagedListing`, `saveListingDraft`, `submitListingForReview` | M04, B12 | Lista |
| F029 | HU-028 | `getListingStatusHistory` | B11 | Lista |
| F020 | HU-017 | `createPhotoUpload`, `registerPhoto`, `removePhoto` | M06, B16 | Lista (m-13, m-16) |
| F021 | HU-018 | `createListing`, `saveListingDraft`, `getPublishedListing` | M05, M09, B16 | Lista (m-10) |
| F022 | HU-019 | `listMunicipalities`, `listCategories`, `listPublishedListings` | B15 | Lista |
| F023 | HU-020 | `getPublishedListing` | B16 | Lista |
| F018 | HU-012 | `createListing` (`route_experience`), `saveListingDraft`, `submitListingForReview`, `approveListingVersion` | M05, M07, B15, B16 | Lista |
| F017 | HU-011 | `listEstablishmentTypes`, `listExperienceTypes`, `createListing`, `submitListingForReview`, `approveListingVersion`, `listPublishedListings` (`gastronomic=true`) | M05, M07, B18 | Lista (m-19) |
| F024 | HU-021 | `listExperienceTypes`, `listPublishedListings` | B17 | Lista |
| F027 | HU-002, HU-020 | `getPublishedListing`, `listPublishedListings`, `getManagedListing`, `createProviderRegistration` | B16, B04 | Lista (m-18) |
| F030 | HU-024 | `createInformationRequest` | B01, B16, B19 | Lista (m-08, Pendiente 6) |
| F031 | HU-025 | `createInformationRequest` (bandeja de salida), `runOutboxRetryJob` | B14 | Lista |
| F032 | HU-026 | `listMyBusinessInformationRequests`, `getInformationRequest`, `replyToInformationRequest`, `changeInformationRequestStatus` | B13, B14, B20 | Lista (m-10) |
| F033 | HU-026 | `getInformationRequest`, `changeInformationRequestStatus` | B13 | Lista |
| F037 | HU-030, HU-024 | `revokeMyAuthorization`, `getPublishedListing`, `createInformationRequest` | B03, B16, B20 | Lista |
| F038 | HU-030 (RNF-021) | `runRetentionJob`, `runMaintenanceJob` | Vercel Cron, `pnpm purge:dry-run`, `pnpm purge:run` | Lista (m-08, Pendiente 3) |

## Pendientes: cuáles bloquean y cuáles no
| Pendiente | ¿Bloquea? | Prioridad afectada |
| --- | --- | --- |
| Arquitectura, Pendientes 1, 2, 4, 5 y 6 (m-08; el 6, por D-059) | No. Se implementan con el valor por defecto, que es configurable | Varias |
| Arquitectura, Pendiente 3: datos posteriores al 31 de enero de 2027 (D-051) | No para el 26 de noviembre de 2026; sí hay que decidirlo antes del 31 de enero de 2027 | 12 |
| Requisitos, reglas de caracteres o longitud por tipo de documento | No. Solo si la usuaria quiere agregarlas; cambiaría solo `validateIdentityNumber` | 1 |
| RNF-019 (rendimiento y accesibilidad) | No | — |
| Hallazgos menores m-10 a m-20 | No. Los corrigen el product-manager y el architect sin preguntar a la usuaria (m-10 requiere que el orchestrator confirme qué incluía D-044) | Varias |

## Preguntas que debe responder la usuaria
No hay ninguna pregunta obligatoria para empezar a construir ni para cerrar en QA. Las rondas de la fase 3 se agotaron. Los valores Inferidos quedan como valores por defecto no bloqueantes (D-059) y no se reabren.

Lo único que queda para la usuaria, sin ronda nueva:
1. **Antes del 31 de enero de 2027:** decidir el plazo para los datos recogidos después de esa fecha y, si el sistema sigue en uso, publicar una versión nueva del aviso (D-051; arquitectura, Pendiente 3).
2. **Al llegar el plazo:** quitar o cambiar a mano `PRINCIPAL_ADMIN_TELEGRAM_ID` en las variables de Vercel, porque la eliminación no lo borra (`docs/03-arquitectura.md`, "Riesgos técnicos").
3. **Opcional, cuando quiera:** aprobar en conjunto los valores por defecto de la arquitectura (Pendientes 1, 2, 4, 5 y 6) y la sustitución técnica de la fecha de vigencia del aviso (m-20). Mientras tanto, el código los aplica como están.
