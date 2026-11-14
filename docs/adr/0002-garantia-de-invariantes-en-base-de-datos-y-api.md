# 0002. Garantía de los invariantes en la base de datos y en la API

- **Estado:** Propuesta (revisada en la iteración 1 de preparación, en la iteración 2: D-046, y en la iteración 3: D-054, D-055)
- **Fecha:** 2026-11-14
- **Fuente:** invariantes 1 a 8 de CLAUDE.md; secciones 2.3, 3.3, 3.8, 3.11, 3.12, 3.14, 3.15 y 3.16; RNF-001 a RNF-012; D-003, D-005, D-007, D-011, D-019, D-020, D-024, D-029, D-036 a D-039, D-042, D-044, D-046, D-054, D-055

## Contexto
Un invariante protegido solo en la interfaz se rompe con una petición directa al backend (F007, F008, F016, F033). Además, la plataforma es serverless con muchas invocaciones concurrentes, así que las comprobaciones "leer y luego escribir" necesitan transacciones y bloqueos.

## Decisión
Cada invariante tiene tres capas: **servicio** (regla y mensaje claro), **API** (contrato y código de error) y **base de datos** (restricción que no se puede saltar). Todas las operaciones de escritura se ejecutan en una transacción; al inicio, el servicio fija `set_config('app.actor_account_id', <uuid>, true)` (local a la transacción, compatible con el pooler en modo transacción) para que los disparadores identifiquen al responsable.

| Invariante | Servicio y API | Base de datos |
| --- | --- | --- |
| 1. Verificación de usuario, rol, negocio y permiso en cada operación | El `Actor` se construye solo a partir de identidad verificada (firma de `initData` o secreto del webhook, ADR 0003); los roles se leen de `role_grants` en cada operación, sin caché entre peticiones. 401 sin identidad válida; 403 sin rol o permiso | Rol de base de datos `eje_app` con permisos mínimos; RLS activo en todas las tablas con política solo para `eje_app` (ADR 0006). Disparadores de transición verifican que el actor de la transacción tenga el rol requerido |
| 2. Separación por negocio | Toda consulta de prestador filtra por `businesses.provider_account_id = actor`. Recurso de otro negocio responde 403 sin revelar si existe | Claves foráneas `listings.business_id` y `information_requests.business_id`; disparador de cambio de estado de solicitud exige que el actor sea el dueño del negocio con rol de prestador activo |
| 3. Solo el administrador aprueba o rechaza; el visitante solo ve publicadas; la versión publicada sigue visible hasta aprobar la nueva | Endpoints de revisión solo para `admin`; consultas públicas leen exclusivamente `listing_versions.status = 'published'` | Índice único parcial: una sola versión `published` por ficha y una sola versión abierta (`draft` o `pending`) por ficha. Disparador de transiciones permitidas: `draft→pending`, `pending→published`, `pending→rejected`, `published→superseded`; `pending→published/rejected` exige actor administrador. CHECK: `rejected` exige `rejection_reason`; `pending` y `published` exigen los campos obligatorios de D-003; `pending` exige la declaración de D-024 en fichas de prestador. La aprobación de una versión nueva y el paso de la anterior a `superseded` ocurren en la misma transacción con bloqueo `SELECT ... FOR UPDATE` sobre la ficha |
| 4. Rol solo si el administrador autorizó el ID de Telegram | Los permisos de prestador nacen únicamente al aprobar un registro; los de administrador, al autorizar un ID o por la variable `PRINCIPAL_ADMIN_TELEGRAM_ID` | CHECK en `role_grants`: `granted_by_account_id` no nulo salvo la fila del administrador principal (`is_principal = true`, índice único parcial). CHECK: un permiso `provider` exige `provider_registration_id` (FK `ON DELETE CASCADE`), y un disparador exige que el registro esté `approved`. Disparadores en `provider_registrations` y `role_grants`: un ID con permiso `admin` activo no puede tener registro ni permiso de prestador (D-038) |
| 5. Sin reservas ni pagos; solo el prestador cambia el estado de la solicitud | No existe ningún endpoint de cupos, pagos ni confirmación; la API de cambio de estado solo admite al prestador dueño | Enum de estados `new`, `attended`, `closed`; disparador que solo permite `new→attended→closed` (HU-026 criterio 5; regla aprobada en D-044) y exige actor dueño. Disparador de inserción rechaza solicitudes a fichas sin versión publicada, a atractivos (sin negocio) o a negocios sin prestador activo (D-029) |
| 6. Funciona sola | Ningún servicio depende de otro aplicativo; Telegram, Supabase y Vercel Blob son parte del stack fijo | No aplica |
| 7. Ley 1581, aviso aceptado antes de recolectar; número de identidad nunca visible al visitante | Sin la versión vigente aceptada solo se permite leer el aviso, consultar `getMe`, aceptar y, con cuenta, revocar. Todo lo demás, incluida la exploración, responde 403 `consent_required` (D-008, D-039). Ningún contador ni registro técnico guarda el ID o la IP de quien no aceptó (ADR 0006). La única excepción es el ID de un administrador autorizado (D-037). Ningún esquema de respuesta pública ni de prestador contiene el número de identidad | No existe fila en `accounts` sin aceptación. `rate_limit_counters` solo admite filas con `account_id`. `consent_events` no tiene identificador de la persona (D-036). El número de identidad se guarda cifrado y solo en `provider_registrations`; en la sesión del bot va sellado (ADR 0005, 0015) |
| 8. Confirmación antes de operaciones importantes | Las operaciones importantes exigen en el cuerpo `confirmed: true`; sin ese campo responden 422. El bot y la Mini App solo lo envían después de que la persona pulsa el botón de confirmar | No aplica |

Duplicados (sección 3.12; D-003):
- Ficha: restricción de exclusión `EXCLUDE USING gist (municipality_id WITH =, name_normalized WITH =, listing_id WITH <>) WHERE (status IN ('draft','pending','published'))` sobre `listing_versions` (extensión `btree_gist`). Impide que dos fichas distintas tengan el mismo nombre en el mismo municipio, y permite que la versión publicada y la pendiente de la misma ficha compartan nombre.
- Municipio, categoría, tipo de experiencia y tipo de establecimiento: índice único sobre el nombre normalizado.
- Registro de prestador: índice único parcial sobre `account_id` y sobre `identity_number_hash` para registros `pending` o `approved`. El hash cubre tipo y número de documento normalizado (Confirmado: D-046, D-054; normalización, D-055; ADR 0005). El tipo es un enum de la base con los cuatro valores de D-046.
- Permiso de administrador: índice único parcial `(telegram_user_id, role) WHERE revoked_at IS NULL`.
- Normalización del nombre: minúsculas, sin tildes (`unaccent` envuelto en función inmutable), espacios colapsados, calculada por disparador. Que "Café Luna" y "cafe luna" sean duplicados es **Inferido** (ver Pendientes de `docs/03-arquitectura.md`).
- Límites de caracteres de D-042 (nombre 100, descripción 1500, horarios 300, contacto 200): CHECK `char_length(...) <= n` en `listing_versions`, además del `maxLength` del contrato.

Concurrencia:
- Límite de fotos y "único administrador": `SELECT ... FOR UPDATE` sobre la versión o sobre las filas de permisos de administrador antes de contar.
- Los errores de restricción de PostgreSQL (`23505`, `23P01`, `23514`, `P0001` de disparadores) se traducen en el servicio a errores de dominio con código estable (`duplicate`, `invalid_state_transition`, etc.).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Solo validación en servicios | Menos SQL | Una carrera o un error de código rompe el invariante sin que nadie lo note |
| RLS completo por actor en todas las tablas | Separación por negocio aun con errores de código | Exige `set_config` del rol y del negocio en cada consulta, incluidas las públicas; complejidad alta para la fecha de entrega (D-026). Se usa RLS solo como barrera frente a la Data API (ADR 0006) |
| Tabla aparte de "nombres reservados" para duplicados | Funciona sin `btree_gist` | Hay que mantenerla sincronizada con disparadores; la restricción de exclusión es declarativa |

## Consecuencias
- Más fácil: QA puede verificar cada invariante con peticiones directas; la base de datos rechaza lo que el código olvide.
- Más difícil: los mensajes de error deben mapearse desde códigos de PostgreSQL; las migraciones incluyen disparadores que hay que probar (pruebas de integración contra PostgreSQL real, ADR 0014).
- `confirmed: true` no prueba que una persona vio la confirmación; solo obliga a todo cliente a declararla. La confirmación real la muestran el bot y la Mini App.
