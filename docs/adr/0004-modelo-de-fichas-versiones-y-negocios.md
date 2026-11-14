# 0004. Prestador, negocio y ficha separados; ficha con versiones publicada y pendiente

- **Estado:** Propuesta (revisada en la iteración 1 de preparación: C-02, M-13, D-040, D-043, D-044; en la iteración 2: M-16, D-048; y en la iteración 3: D-052, D-058)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 2.4, 3.2, 3.3, 3.4, 3.5 y 3.12; HU-009 a HU-012, HU-014 a HU-016, HU-028; D-003, D-004, D-005, D-006, D-014, D-019, D-024, D-029, D-040, D-043, D-044, D-048, D-052, D-058; guía de agentes (architect)

## Contexto
- Errores comunes señalados por la guía: modelar prestador y establecimiento como lo mismo, y sobrescribir la ficha publicada al editar.
- Una ficha puede tener a la vez una versión publicada visible y una versión pendiente (sección 3.3). Si se rechaza la pendiente, se descarta y se conserva la publicada.
- Un prestador puede tener varios negocios (D-006); "negocio" es la unidad de separación (sección 2.4, Inferido). Una ficha por negocio es Inferido (HU-010 criterio 5).
- Los atractivos los registra el administrador y se publican sin validación (D-005); no tienen prestador ni solicitudes (HU-024 criterio 6, Inferido).
- Al revocar, las fichas publicadas del prestador siguen visibles hasta el 31 de enero de 2027 sin "Solicitar información" y las no publicadas quedan como están (D-019, D-029).

## Decisión
Entidades:
- `accounts`: persona que aceptó el aviso (ID de Telegram). No es prestador por sí misma.
- `provider_registrations`: registro con número de identidad (ADR 0005).
- `role_grants`: permisos `admin` o `provider`.
- `businesses`: negocio, con `provider_account_id` (FK a `accounts`, `ON DELETE SET NULL`). Es el límite de separación de datos.
- `listings`: ficha. `kind ∈ {attraction, establishment, route_experience}`. `business_id` nulo si y solo si `kind = 'attraction'` (CHECK). `business_id` único (una ficha por negocio, Inferido; se elimina la unicidad si la usuaria decide lo contrario).
- `listing_versions`: contenido de la ficha. `status ∈ {draft, pending, published, rejected, superseded}`. Campos: nombre (hasta 100 caracteres), municipio, categoría, tipo de establecimiento (solo `establishment`, **opcional** también al enviar y al publicar, D-040), tipo de experiencia (solo `route_experience`, obligatorio al enviar, F018), descripción (hasta 1500), horarios (hasta 300), contacto (hasta 200), enlace de Maps, datos de guías (solo `route_experience`, texto, D-014), declaración de terceros (`third_party_declared_at`, D-024), motivo de rechazo, fechas y responsables. Los límites de caracteres son de D-042 y se aplican con CHECK en la base y con `maxLength` en el contrato.
- CHECK de campos obligatorios en `pending` y `published`: exactamente los de D-003 (nombre, municipio, categoría, descripción, horarios, contacto y enlace de Maps), más el tipo de experiencia en `route_experience` (F018). `establishment_type_id` puede ser nulo en cualquier estado (D-040). CHECK de coherencia: `establishment_type_id` solo puede tener valor si `kind = 'establishment'`, y `experience_type_id` solo si `kind = 'route_experience'`.
- `listing_photos`: fotos de una versión (ADR 0009).
- `listing_status_events`: historial de estados por ficha (HU-028), escrito por disparador.

Reglas del ciclo de vida:
- Crear ficha de prestador: crea en una transacción el negocio, la ficha y una versión `draft` (HU-010 criterio 1).
- Crear atractivo (administrador): crea la ficha y una versión `published` directamente (D-005).
- Editar: si hay una versión `draft`, se actualiza; si no la hay, se crea una nueva `draft` copiando el contenido y las fotos de la versión más reciente (publicada o rechazada). Una versión `pending` no se edita (HU-010 criterio 2; regla aprobada en D-044).
- Enviar a revisión: `draft → pending`, con los campos obligatorios de D-003 completos (y el tipo de experiencia en rutas), sin duplicado, con `confirmed: true` y `thirdPartyAuthorizationDeclared: true` (D-024). El tipo de establecimiento no se exige (D-040).
- Aprobar: `pending → published`; la publicada anterior pasa a `superseded`, en la misma transacción (HU-016 criterio 2).
- Rechazar: `pending → rejected` con motivo obligatorio. La publicada no cambia (HU-016 criterio 3). El prestador corrige creando una nueva `draft` a partir de la rechazada (HU-015 criterio 3; regla aprobada en D-044).
- No existe despublicar ni eliminar fichas (D-014).

Estado que ve el prestador (derivado):
- `draft`, `pending` o `rejected` según la versión de trabajo más reciente; además `hasPublishedVersion`. Ejemplo: una ficha publicada con edición pendiente se muestra como "Publicada, con cambios pendientes de aprobación".

Visibilidad para el visitante: solo `status = 'published'`, y solo para personas con el aviso vigente aceptado (D-039). `acceptsRequests` es verdadero si la ficha es de un negocio y ese negocio tiene un prestador con permiso `provider` activo. Así se cubren los dos casos confirmados:
- El prestador revoca su autorización: el negocio queda sin prestador (D-029).
- El administrador usa "Revocar rol" sobre el prestador: solo pierde el rol, sus fichas no cambian de estado y sus fichas publicadas dejan de aceptar solicitudes nuevas (D-043). Las solicitudes que ya existían se conservan sin acceso para nadie hasta que recupere el rol o hasta la eliminación del 31 de enero de 2027. Que se conserven se deduce de "solo le quita el rol" (D-043).

Tipos de establecimiento (D-040):
- Lista cerrada administrada por el administrador en la Mini App (D-041), con el mismo modelo que las categorías (`establishment_types`). La semilla de referencia carga hotel, finca cafetera, alojamiento rural, restaurante y café.
- Es un dato opcional de la ficha de establecimiento.

Directorio gastronómico (sección 3.4; D-004, D-040, D-048):
- Lo forman dos grupos de fichas publicadas (Confirmado, D-048):
  - fichas `establishment` cuyo tipo de establecimiento tiene `is_gastronomic`: restaurante y café (D-040; D-048 deja D-040 como la lista de tipos de establecimiento del directorio);
  - fichas `route_experience` cuyo tipo de experiencia tiene `is_gastronomic`: el tipo de experiencia gastronómica "Sabores de Caldas" que carga la semilla de referencia (sección 3.4, "experiencias gastronómicas"; D-048, D-052).
- El mecanismo son las columnas `establishment_types.is_gastronomic` y `experience_types.is_gastronomic`, con valor falso por defecto. Solo la semilla de referencia las marca (ADR 0011): restaurante y café, y un único tipo de experiencia gastronómica. Las protegen dos capas:
  - API: ningún esquema de entrada tiene el campo, y `createExperienceType`, `updateExperienceType`, `createEstablishmentType` y `updateEstablishmentType` no lo cambian;
  - base de datos: el rol `eje_app` no tiene privilegio de columna `INSERT` ni `UPDATE` sobre `is_gastronomic` en ninguna de las dos tablas. La semilla se carga con el rol de migraciones.
- El tipo de experiencia gastronómica se llama "Sabores de Caldas" (Confirmado, D-052). La semilla lo carga con ese nombre y un UUID fijo en todos los entornos, de modo que cambiar el nombre en M11 no cambia la fila ni la marca (ADR 0011).
- `listPublishedListings` con `gastronomic=true` devuelve la unión de los dos grupos, con los mismos filtros de municipio y paginación que el resto de la exploración. B18 muestra los dos grupos.
- Una ficha de establecimiento sin tipo, o una experiencia de un tipo no gastronómico, no aparece en el directorio gastronómico. Sí aparece en la exploración por municipio y categoría, y la experiencia también en la de tipo de experiencia (B17).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Una tabla `listings` con columnas duplicadas `published_*` y `pending_*` | Consultas simples | Duplica cada campo y las fotos; difícil de auditar; propenso a sobrescribir |
| Historial como copia JSON en una tabla de auditoría | Flexible | La versión publicada no tendría restricciones ni claves foráneas |
| Ficha ligada directamente al prestador (sin negocio) | Menos tablas | Es el error común de la guía; impide la separación por negocio y conservar fichas al revocar |
| Experiencias gastronómicas como un nuevo `kind` de ficha | El directorio no depende del catálogo | Duplica el formulario y las reglas de `route_experience`; D-048 pide un tipo de experiencia, no un tipo de ficha |
| Permitir que el administrador marque `is_gastronomic` en M11 | Flexible | El directorio dejaría de coincidir con D-040 y D-048 sin una decisión de la usuaria |
| Reconocer el tipo gastronómico por su nombre | Sin columna | El administrador puede editar el nombre "Sabores de Caldas" en M11; la marca en la fila no depende del nombre |

## Consecuencias
- Más fácil: la versión publicada nunca se modifica en sitio; el historial y la comparación entre versiones (HU-016 criterio 4) salen de comparar dos filas.
- Más difícil: copiar fotos (referencias) al crear un borrador; limpiar fotos huérfanas de versiones descartadas (ADR 0007).
- Al revocar un prestador, `businesses.provider_account_id` queda nulo: sus fichas no publicadas no las puede editar nadie y nunca son visibles; las publicadas siguen visibles hasta la eliminación del 31 de enero de 2027, que borra las fichas de prestadores con sus fotos (D-043).
- Un prestador que no elige tipo de establecimiento no aparece en el directorio gastronómico, aunque su ficha sea de un restaurante. Es efecto de D-040 (tipo opcional). Se propone que el formulario M05 lo advierta junto al campo (texto Inferido).
- Las experiencias gastronómicas entran al directorio sin cambios en el esquema de fichas: basta con la fila sembrada "Sabores de Caldas" (D-048, D-052). F017, paso 5, crea fichas `route_experience`, que es la capacidad de F018; por eso F017 depende de F018, que se construye antes (F018 con prioridad 6 y F017 con prioridad 7, D-058).
