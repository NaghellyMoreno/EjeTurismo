# Revisión de preparación para la implementación

- **Fecha:** 2026-11-14
- **Iteración:** 2 (máximo 3)
- **Veredicto:** CONCERNS

## Resumen
Los dos hallazgos críticos de la iteración 1 están resueltos. Los límites de intentos solo cuentan cuentas con aviso aceptado (ADR 0006), y el tipo de establecimiento es opcional en el contrato, en la ADR 0004 y en el modelo de datos (D-040). D-034 a D-044 están aplicadas en la arquitectura, en el contrato y en las funcionalidades. Ningún documento contradice el contexto por iniciativa propia, ni se coló nada de lo que está fuera de alcance. Quedan 5 hallazgos mayores. Tres no los puede resolver ningún agente. El primero es el formato del número de identidad (D-045), que bloquea el cierre en QA de F002 y, por dependencia, de casi toda la ruta de prioridad 1. El segundo es la contradicción entre D-038 y D-044. El tercero es la diferencia entre la sección 3.4 y D-040 sobre las experiencias gastronómicas. Los otros dos son un paso de F010 que choca con la semilla de municipios y el texto del aviso 2.5, que sigue sin redactar.

## Estado de los hallazgos de la iteración 1
| ID | Estado | Evidencia |
| --- | --- | --- |
| C-01 | Resuelto | `docs/adr/0006-seguridad-transversal.md`, "Límites de intentos": solo por `account_id`, sin IP ni ID de Telegram. `docs/03-arquitectura.md`, "Entidades" (`rate_limit_counters`, `processed_updates`). `api/openapi.yaml`, `info.description` |
| C-02 | Resuelto | `api/openapi.yaml`, `ListingContentInput` y `submitListingForReview`; `docs/adr/0004-modelo-de-fichas-versiones-y-negocios.md`, "Decisión" (D-040) |
| M-01 | Parcial | El texto del aviso está aprobado (D-034). Siguen abiertos el formato del número de identidad (D-045, ver M-01 abajo), el aviso 2.5 (M-18) y el número de versión (m-17) |
| M-02 | Resuelto | D-035; `docs/adr/0010-region-de-los-servidores.md` (Aceptada); `docs/adr/0012-publicacion-entornos-y-variables.md` |
| M-03 | Resuelto | D-036; `docs/adr/0005-datos-personales-consentimiento-y-revocacion.md`, "Prueba de autorización y revocación"; `consent_events` sin identificador |
| M-04 | Resuelto | D-037; ADR 0005, "ID de Telegram de administradores autorizados"; `docs/05-aviso-privacidad.md`, apartado 2 |
| M-05 | Resuelto | `api/openapi.yaml`, `revokeMyAuthorization` (`x-roles: [account_holder]`). Que el botón aparezca en B01 y M01 queda como Inferido no bloqueante (m-08) |
| M-06 | Resuelto | `docs/adr/0015-formularios-conversacionales-del-bot.md`, "Datos sensibles en la sesión" (número sellado con AES-256-GCM y vencimiento) |
| M-07 | Resuelto | D-039; `docs/03-arquitectura.md`, "Matriz de permisos"; `feature_list.json`, F030, paso 1 |
| M-08 | Resuelto en los documentos | D-038 está aplicada en todos los documentos. Queda la contradicción entre decisiones congeladas (M-15) |
| M-09 | Resuelto | D-044 aprueba las herramientas de la ADR 0014 (ver m-15 por el estado de la ADR) |
| M-10 | Resuelto | F038 y RNF-021 en `feature_list.json` y `docs/02-requisitos.md`. La arquitectura no se actualizó (m-09) |
| M-11 | Resuelto | D-042; `feature_list.json`, F020, paso 4; ADR 0009, "Cómo se verifica cada límite" |
| M-12 | Resuelto | D-041; `api/openapi.yaml`, operaciones de catálogos ("Canal Mini App") |
| M-13 | Resuelto, con un hallazgo nuevo | D-040; ADR 0004, "Tipos de establecimiento" y ADR 0011. Queda la parte de las experiencias gastronómicas (M-16) |
| M-14 | Resuelto para los campos de la ficha | D-042 en `ListingContentInput`. Los demás campos tienen un máximo técnico de 4096 caracteres (arquitectura, Pendiente 6; m-08) |
| m-01 | Resuelto, con un hallazgo nuevo | La nota nueva del brief también quedó desactualizada (m-11) |
| m-02 | Resuelto | `feature_list.json`, F027, paso 2 |
| m-03 | Resuelto | `feature_list.json`, F013, pasos 10 y 11; RNF-013 |
| m-04 | Resuelto | `feature_list.json`, F020, paso 5 |
| m-05 | Resuelto | `docs/03-arquitectura.md`, "Entidades" (`listing_photos`); ADR 0009, "Versiones editables para fotos" |
| m-06 | Resuelto | D-043; ADR 0004, "Visibilidad para el visitante" |
| m-07 | Resuelto | `docs/03-arquitectura.md`, "Entidades" (`role_grants.provider_registration_id` con `ON DELETE CASCADE`) |
| m-08 | No resuelto (menor) | Ver m-08 abajo |

## Hallazgos
| ID | Severidad | Archivo y sección | Problema | Responsable |
| --- | --- | --- | --- | --- |
| M-01 | Mayor | Registro de decisiones congeladas, D-045; `docs/02-requisitos.md`, HU-002, criterio 4; `feature_list.json`, F002, paso 2; ADR 0005, "Número de identidad" | El formato válido del número de identidad sigue Pendiente. Se puede construir, porque la validación está aislada en `validateIdentityNumber`, pero F002, paso 2, no se puede cerrar en QA. Por `depends_on`, eso deja sin cierre F003, F005 a F009, F028, F035 y F036 (prioridad 1) y todo lo que depende de ellas. Faltan 12 días para la entrega (D-026). Ver "Asuntos aparte", B. | usuaria (vía orchestrator) |
| M-15 | Mayor | Registro de decisiones congeladas, D-038 y D-044; `docs/03-arquitectura.md`, "Riesgos técnicos" (última fila); `docs/01-brief.md`, "Preguntas abiertas", 23; `docs/02-requisitos.md`, "Pendientes" | D-044 aprueba en bloque las reglas Inferidas del antiguo Pendiente 22, que incluía "un administrador también puede registrarse como prestador". D-038 dice lo contrario. Todos los documentos aplican D-038, así que contradicen D-044 al pie de la letra. Ningún agente puede resolverlo, porque las decisiones están congeladas. Afecta a F005, paso 3 (prioridad 1), al disparador de `provider_registrations` y a `Me.canRegisterAsProvider`. No lo califico como crítico porque los documentos no pueden cumplir las dos decisiones a la vez, y aplican la específica. Ver "Asuntos aparte", A. | usuaria; el orchestrator registra la aclaración |
| M-16 | Mayor | `docs/00-contexto-producto.md`, sección 3.4 ("Directorio de restaurantes, cafés y experiencias gastronómicas", Confirmado); D-040; `docs/adr/0004-modelo-de-fichas-versiones-y-negocios.md`, "Directorio gastronómico"; `docs/03-arquitectura.md`, Pendiente 4; `feature_list.json`, F017, descripción | Por defecto, la arquitectura deja el directorio solo con restaurante y café: `experience_types.is_gastronomic` vale falso y la API no la puede cambiar. Así, el directorio no incluye las experiencias gastronómicas que la sección 3.4 confirma. Además, F017 promete que "una experiencia gastronómica" aparece en el directorio, y con el diseño por defecto no aparecería. El developer tendría que elegir entre la ADR 0004 y F017. El mecanismo ya existe; solo falta decidir qué marca la semilla. | usuaria; después, el architect (semilla, ADR 0011) y el product-manager (F017) |
| M-17 | Mayor | `feature_list.json`, F010, pasos 1 y 3; `docs/adr/0011-datos-semilla.md`, "Decisión", nivel 1 | La semilla de referencia carga Manizales, Supía y Filadelfia en todos los entornos (D-027). F010, paso 1, pide crear "el municipio Manizales", así que en QA respondería 409 `duplicate` y el paso fallaría. Hay que cambiar el paso para crear un municipio de prueba y verificar que los tres iniciales ya están. | product-manager |
| M-18 | Mayor | `docs/05-aviso-privacidad.md`, apartado 2.5 y Pendiente 4; `feature_list.json`, F037, paso 7; `docs/02-requisitos.md`, HU-030, criterio 8 | No hay texto para el mensaje al visitante cuya solicitud se borra porque el prestador revocó (D-029). Sin él, el developer tendría que inventar un mensaje sobre datos personales. Bloquea el cierre de F037 (prioridad 11), no las de prioridad 1. | product-manager (propone); usuaria (aprueba) |
| m-08 | Menor | `docs/03-arquitectura.md`, Pendientes 2, 3, 5, 6, 7 y 8 | Siguen sin aprobar estos valores por defecto: `role_conflict` al autorizar como administrador a un prestador; "Revocar mi autorización" en B01 y M01; qué pasa con los datos recogidos después del 31 de enero de 2027; 4096 caracteres en los campos que D-042 no cubre; semillas sin categorías; y los valores técnicos de la lista 8. No bloquean la construcción. El Pendiente 5 hay que decidirlo antes del 31 de enero de 2027, porque después de esa fecha el aviso (apartado 6) ya no describiría lo que hace el sistema. | usuaria (aprobación conjunta) |
| m-09 | Menor | `docs/03-arquitectura.md`, encabezado ("34 funcionalidades"), "Tareas programadas" (último párrafo) y "Trazabilidad" (fila "Sin funcionalidad todavía"); `docs/adr/0007-tareas-programadas-y-en-segundo-plano.md`, "Consecuencias" | La arquitectura dice que la eliminación no tiene funcionalidad, pero F038 ya existe y hay 35 funcionalidades. Hay que agregar la fila de F038 (`runRetentionJob`, `runMaintenanceJob`). | architect |
| m-10 | Menor | `docs/02-requisitos.md`, HU-005 criterio 6, HU-010 criterio 2, HU-015 criterio 3, HU-018 criterio 2, HU-024 criterios 3 y 6, HU-026 criterio 5, y "Pendientes"; `feature_list.json`, F006 paso 7, F013 paso 6, F014 paso 5, F021 paso 1 y F032 paso 5; `docs/01-brief.md`, "Sin respuesta tras la ronda 3", 21 | La arquitectura y el contrato citan estas reglas como "aprobadas en D-044". Los requisitos, las funcionalidades y el brief las siguen marcando como Inferidas, y en F006 aparece "pregunta 21 sin respuesta". QA no sabría si puede cerrar esos pasos. El comportamiento no cambia. | product-manager; el orchestrator confirma qué incluía el Pendiente 22 |
| m-11 | Menor | `docs/01-brief.md`, "Nota para el orquestador", "Supuestos y riesgos" (fila de "Revocar rol" y fila de varios negocios) | El brief dice que F001 y F002 todavía citan D-033 y que F006 marca como Pendiente lo resuelto por D-043. `feature_list.json` ya está corregido. También da por Pendiente la asociación entre ficha y negocio, que la ADR 0004 resuelve: una ficha por negocio, Inferido. | product-manager |
| m-12 | Menor | `feature_list.json`, F011; `docs/02-requisitos.md`, HU-008 y HU-010, criterio 6 | Ningún paso verifica crear o editar tipos de establecimiento (D-040, D-041), ni que un tipo nuevo no entre al directorio gastronómico, aunque los endpoints y la pantalla M11 existen. | product-manager |
| m-13 | Menor | `feature_list.json`, F020, pasos 5 y 6 | En el paso 5 se quita una de las 10 fotos, y el paso 6 envía "la ficha con 10 fotos". La secuencia no cuadra. | product-manager |
| m-14 | Menor | `feature_list.json`, F006 paso 8 y F035 paso 6; `docs/adr/0003-autenticacion-sesiones-roles-y-autorizacion.md`, "Actor y roles" | El administrador principal siempre existe y no se puede revocar. Por eso la única forma de que haya "un solo administrador" es que sea el principal, y en ese caso el error es `principal_admin_protected`. Con los pasos actuales, `last_admin_protected` no se puede alcanzar. Falta decir cómo se prepara ese escenario en el entorno de pruebas, o aceptar que lo cubre una prueba de integración. | architect (escenario); product-manager (pasos) |
| m-15 | Menor | `docs/adr/0014-herramientas-migraciones-y-pruebas.md`, "Estado" | Dice "Propuesta" aunque D-044 la aprobó. | architect |
| m-16 | Menor | `docs/adr/0009-fotografias-en-vercel-blob-y-limites.md`, "Límites vigentes" | MB se interpreta en unidades decimales (5 000 000 bytes), pero 2 GB se toma como 2 147 483 648 bytes (binario). Conviene una sola convención. | architect |
| m-17 | Menor | `docs/05-aviso-privacidad.md`, Texto 1 (encabezado), apartado 2.1 y Pendiente 5 | La versión sigue siendo "2026-11-v2", aunque el texto cambió con D-034, D-037 y D-039. Además, dice "Vigente desde el 2 de noviembre de 2026", fecha anterior a la aprobación (14 de noviembre). No bloquea: el valor se carga por semilla y se cambia con `pnpm notice:publish`. | usuaria |

Conteo: 0 críticos, 5 mayores y 10 menores.

## Verificaciones con resultado favorable
- **Cobertura:** las 35 funcionalidades aparecen en la tabla "Trazabilidad" de `docs/02-requisitos.md` y tienen pasos verificables. HU-013, HU-022, HU-023 y HU-029 quedan fuera según D-030.
- **Contrato:** cada operación de `api/openapi.yaml` (versión 0.2.0) declara `x-roles` y usa el esquema de error `Problem`. Cada una sirve a una funcionalidad: `runRetentionJob` a F038, y la bandeja de salida a F031, F032 y F037. Ninguna funcionalidad depende de un endpoint inexistente.
- **Invariantes 1 a 8:** cada uno tiene mecanismo en el servicio, la API y la base de datos (`docs/03-arquitectura.md`, "Mecanismo de cada invariante en el backend"). El invariante 7 queda reforzado por D-036, D-037 y D-039 y por los contadores que solo cuentan cuentas.
- **Seguridad del contexto (sección 3.16):** `initData` con HMAC y vigencia, secreto del webhook con fail closed, esquema `app` fuera de la Data API, RLS, número de identidad cifrado y sellado, y logger con redacción (`docs/03-arquitectura.md`, "Seguridad").
- **Fuera de alcance (sección 3.14):** no hay cupos, pagos ni confirmación automática. Google Maps es solo un enlace (ADR 0016) y no hay integraciones obligatorias.
- **Publicación:** Vercel Hobby, `gru1`, con webhook, sin disco, Supabase Free en `sa-east-1` y Blob privado en `gru1` (D-035). Los crons son diarios, compatibles con Hobby. Los riesgos de pausa de Supabase Free y del dato del administrador principal en las variables están documentados.
- **Decisiones D-034 a D-043:** se reflejan sin contradicción en la arquitectura, el contrato, las ADR, el aviso y `feature_list.json`. Las excepciones son D-044 frente a D-038 (M-15) y la marca de las reglas aprobadas por D-044 (m-10).
- **Guía (readiness-reviewer):** hay reglas de separación por negocio, validación del prestador, prevención de duplicados y manejo de errores y cancelaciones. Las decisiones de stack que no están en `CLAUDE.md` están aprobadas en D-044 y D-035.

## Matriz de trazabilidad
| Funcionalidad | Historias | Endpoints | Pantallas o comandos | Estado |
| --- | --- | --- | --- | --- |
| F001 | HU-001 | `getCurrentPrivacyNotice`, `acceptPrivacyNotice`, `getMe` | B01, B02 | Lista (m-17) |
| F002 | HU-002 | `createProviderRegistration`, `getMyProviderRegistration` | B04, B05, B21 | Construible; cierre en QA bloqueado por M-01 |
| F003 | HU-003 | `listProviderRegistrations`, `approveProviderRegistration`, `rejectProviderRegistration` | B06, B07, B20 | Lista; cierre depende de F002 (M-01) |
| F004 | HU-004 | `authorizeAdministrator`, `listRoleGrants`, `getMe` | B02, B06, B08 | Lista (m-08, Pendiente 2) |
| F005 | HU-006 | `getMe`, `createProviderRegistration` (403) | B02, B06, B12, M02 | Con hallazgo: M-15 (paso 3) |
| F006 | HU-005 | `listRoleGrants`, `revokeRole` | B09 | Lista (m-10, m-14) |
| F007 | HU-003, HU-006 | Operaciones `provider` y `admin` (401 y 403) | B02 | Lista |
| F008 | HU-004, HU-014 | `authorizeAdministrator`, `createMunicipality`, `createCategory`, `approveListingVersion` | B12, M02 | Lista |
| F009 | HU-006 | Todas las de `telegramInitData` | M01 a M12 | Lista |
| F028 | HU-027 | `createProviderRegistration` | B04, B21 | Lista |
| F034 | HU-030 | `revokeMyAuthorization` | B01, B02, B03 | Lista |
| F035 | HU-030 | `revokeMyAuthorization` | B03 | Lista (m-14) |
| F036 | HU-001, HU-030 | `getCurrentPrivacyNotice`, `acceptPrivacyNotice`, `getMe`, `revokeMyAuthorization` | M01, M02, M03 | Lista |
| F010 | HU-007 | `listMunicipalities`, `createMunicipality`, `updateMunicipality` | M10, B15 | Con hallazgo: M-17 |
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
| F017 | HU-011 | `createListing`, `submitListingForReview`, `approveListingVersion`, `listPublishedListings` (`gastronomic=true`) | M05, M07, B18 | Con hallazgo: M-16 |
| F018 | HU-012 | `createListing` (`route_experience`), `saveListingDraft`, `submitListingForReview`, `approveListingVersion` | M05, M07, B15, B16 | Lista |
| F024 | HU-021 | `listExperienceTypes`, `listPublishedListings` | B17 | Lista |
| F027 | HU-002, HU-020 | `getPublishedListing`, `listPublishedListings`, `getManagedListing`, `createProviderRegistration` | B16, B04 | Lista |
| F030 | HU-024 | `createInformationRequest` | B01, B16, B19 | Lista (m-10) |
| F031 | HU-025 | `createInformationRequest` (bandeja de salida) | B14 | Lista |
| F032 | HU-026 | `listMyBusinessInformationRequests`, `getInformationRequest`, `replyToInformationRequest`, `changeInformationRequestStatus` | B13, B14, B20 | Lista (m-10) |
| F033 | HU-026 | `getInformationRequest`, `changeInformationRequestStatus` | B13 | Lista |
| F037 | HU-030, HU-024 | `revokeMyAuthorization`, `getPublishedListing`, `createInformationRequest` | B03, B16, B20 | Con hallazgo: M-18 |
| F038 | HU-030 (RNF-021) | `runRetentionJob`, `runMaintenanceJob` | Vercel Cron, `pnpm purge:dry-run`, `pnpm purge:run` | Lista (m-09; m-08, Pendiente 5) |

## Pendientes: cuáles bloquean y cuáles no
| Pendiente | ¿Bloquea? | Prioridad afectada |
| --- | --- | --- |
| D-045: formato del número de identidad (M-01) | Sí. No impide construir, pero sí cerrar en QA F002 y, por dependencia, casi toda la ruta | 1 |
| Contradicción entre D-038 y D-044 (M-15) | Sí, para cerrar F005, paso 3, sin riesgo de retrabajo. Mientras tanto se construye con D-038 | 1 |
| F010, paso 1, frente a la semilla (M-17) | Sí, para el QA de F010. Lo corrige el product-manager sin preguntar a la usuaria | 2 |
| Sección 3.4 frente a D-040: experiencias gastronómicas (M-16) | Sí, para F017 | 6 |
| Aviso 2.5: texto al visitante (M-18) | Sí, para cerrar F037 | 11 |
| Número de versión y fecha de vigencia del aviso (m-17) | No. Hay que decidirlos antes de cargar el aviso en producción | 1 (solo el texto) |
| Arquitectura, Pendientes 2, 3, 6, 7 y 8 (m-08) | No: se implementan con el valor por defecto y se pueden configurar | Varias |
| Arquitectura, Pendiente 5: datos posteriores al 31 de enero de 2027 (m-08) | No para el 26 de noviembre de 2026; sí antes del 31 de enero de 2027 | 12 |
| RNF-019 (rendimiento y accesibilidad) | No | — |

## Asuntos aparte para la usuaria

### A. Contradicción entre D-038 y D-044 (M-15)
- **Qué pasa:** D-038 dice que una cuenta con rol de administrador no puede registrarse también como prestador. D-044 aprueba en bloque las reglas Inferidas del antiguo Pendiente 22 de la arquitectura, y una de ellas decía lo contrario. Las dos están congeladas y no se pueden editar.
- **Qué aplican hoy los documentos:** D-038 (HU-006, criterio 3; F005, paso 3; ADR 0005; código 403 `admin_cannot_register_as_provider`).
- **Recomendación:** confirmar que vale D-038. Es la decisión específica, coincide con D-007 (al administrador no se le pide número de identidad) y no exige ningún cambio en los documentos. El orchestrator la registraría como una fila nueva que aclare que D-044 no incluye esa regla.
- **Si se elige D-044:** habría que cambiar HU-006, criterio 3, F005, paso 3, los disparadores de `provider_registrations` y `role_grants`, `Me.canRegisterAsProvider` y el código de error, y decidir si un administrador entrega número de identidad (lo que choca con D-007).

### B. Formato del número de identidad (D-045; M-01)
- **Qué pasa:** sin formato, F002, paso 2 ("formato inválido") no tiene criterio de aprobación. Hoy el código solo exige texto no vacío y sin caracteres de control (ADR 0005).
- **Recomendación:** fijar "solo dígitos, quitando puntos y espacios al normalizar", con la longitud mínima y máxima que usted indique. Es Inferido: deja fuera la cédula de extranjería o el pasaporte si llevan letras. Si en esta ronda no hay cifras, la alternativa que desbloquea sin inventar reglas es aceptar como formato válido lo que el código ya aplica y ajustar F002, paso 2, a una entrada vacía o con caracteres de control.
- **Efecto:** con cualquiera de las dos opciones, F002 puede cerrarse en QA y se desbloquea la cadena de prioridad 1.

## Preguntas que debe responder la usuaria
Las decisiones congeladas no se reabren. Estas preguntas recogen los Pendientes que declaran los documentos. El orchestrator decide cómo plantearlas dentro del límite de rondas.
1. **¿Las experiencias gastronómicas entran al directorio gastronómico? (M-16; toca la sección 3.4)** Recomendación: sí. Agregar a la semilla un tipo de experiencia gastronómica marcado como `is_gastronomic`, con el nombre que usted indique. Así se cumple la sección 3.4 (Confirmado), y D-040 queda leído como la lista de tipos de establecimiento del directorio.
2. **Texto del aviso al visitante cuyo prestador revocó (aviso 2.5; M-18).** Recomendación: aprobar un texto paralelo al 2.4, redactado por el product-manager. Por ejemplo, Inferido: "Una solicitud que enviaste ya no está disponible porque el prestador retiró su autorización."
3. **Versión y fecha de vigencia del aviso (m-17).** Recomendación: "2026-11-v3", vigente desde la fecha de publicación en producción, porque el texto cambió después de la v2 (D-034, D-037 y D-039).
4. **Valores por defecto de la arquitectura, Pendientes 2, 3, 6, 7 y 8 (m-08).** Recomendación: aprobarlos en conjunto tal como están. Son restrictivos y configurables.
5. **¿Qué plazo aplica a los datos recogidos después del 31 de enero de 2027? (arquitectura, Pendiente 5)** Recomendación: decidirlo antes de esa fecha. Si el sistema sigue en uso, publicar una versión nueva del aviso con el plazo nuevo. No bloquea la entrega del 26 de noviembre de 2026.
