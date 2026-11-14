# 0005. Datos personales: consentimiento antes de guardar, número de identidad cifrado y revocación transaccional

- **Estado:** Propuesta (revisada en la iteración 1 de preparación con D-034 a D-045, en la iteración 2 con D-046, D-047, D-050 y D-051, y en la iteración 3 con D-054 a D-057)
- **Fecha:** 2026-11-14
- **Fuente:** secciones 3.12, 3.15 y 3.16; invariante 7; HU-001, HU-002, HU-004, HU-030; RNF-007 a RNF-009, RNF-021, RNF-022; D-007, D-008, D-011, D-018 a D-021, D-023, D-025, D-029, D-034, D-036 a D-039, D-043, D-045 a D-047, D-050, D-051, D-054 a D-057; `docs/05-aviso-privacidad.md`

## Contexto
- Sin aceptar el aviso no se guarda ningún dato (D-008). El aviso se acepta antes de cualquier uso del bot, incluida la exploración de fichas (D-039). Cada versión nueva obliga a aceptar de nuevo (D-025).
- Excepción confirmada: el ID de Telegram de un administrador autorizado se guarda antes de que esa persona acepte el aviso, y el aviso lo menciona (D-037).
- El número de identidad solo lo ven los administradores y nunca aparece en registros técnicos (D-011; guía de agentes).
- Al revocar, se borra de inmediato la vinculación del chat. Solo queda la prueba de autorización y revocación, con fecha, canal y versión del aviso y sin ningún pseudónimo del ID de Telegram (D-019, D-021, D-036). Esa prueba se elimina el 31 de enero de 2027 (D-021, D-043).
- Una cuenta con rol de administrador no puede registrarse también como prestador (D-038, confirmada por D-047).
- Formato del documento de identidad (D-046, cierra D-045): el número es texto y va acompañado de un tipo de documento, que solo puede ser CC, CE, PPT o PA. D-046 no fija reglas de caracteres ni de longitud por tipo (HU-002, criterio 4).
- El duplicado del registro compara tipo y número de documento (D-054). Se aprueban la normalización del número, los nombres visibles de las siglas, la sigla aceptada en minúsculas y el máximo técnico de 4096 caracteres (D-055).
- El aviso, apartado 2, dice "tu tipo y número de documento de identidad", dentro de la versión "2026-11-v3" (D-056). El texto del mensaje del apartado 2.5, para el visitante cuya solicitud se borra porque el prestador revocó, está aprobado (D-057).
- La versión vigente del aviso es "2026-11-v3", con vigencia desde su publicación en producción (D-050).

## Decisión
**Aviso y aceptación.**
- Tabla `privacy_notice_versions(version, body_markdown, declaration_text, revocation_note, published_at, is_current)`, con un índice único parcial que permite una sola versión vigente. El texto aprobado (D-034) se carga por semilla con `version = '2026-11-v3'` (D-050). Publicar una versión nueva es un script de operación (`pnpm notice:publish`), no una función de la interfaz.
- Fecha de vigencia (D-050): `published_at` toma el momento en que la semilla de referencia carga la versión en cada entorno; en producción, esa es la fecha de publicación. El encabezado del aviso trae el marcador "[fecha de publicación en producción]", y la interfaz lo reemplaza por `published_at` en America/Bogota al mostrarlo. Es una sustitución técnica, no un cambio de redacción (Inferido).
- La mención del tipo de documento (D-056) va en el mismo texto "2026-11-v3", que se carga por semilla tal como quede en `docs/05-aviso-privacidad.md` (ADR 0011). Si en algún entorno ya se cargó un texto anterior con esa versión, se publica una versión nueva (D-025).
- El texto del apartado 2.5 (D-057) no es parte del cuerpo del aviso: es la plantilla del mensaje que la bandeja de salida envía al visitante cuando la revocación del prestador borra su solicitud (paso 3 de la revocación, abajo; ADR 0007). Se copia sin cambios en `src/bot/texts/es.ts`.
- Antes de aceptar, el bot y la Mini App muestran el aviso sin escribir nada: no se crea sesión, cuenta, contador ni registro técnico con el ID de Telegram o la IP (ADR 0006). Cualquier mensaje o botón de una persona sin cuenta recibe el aviso como respuesta (D-039). "No acepto" responde sin persistir nada.
- Al aceptar, en una sola transacción se crea o actualiza `accounts(telegram_user_id, telegram_display_name, consent_notice_version, consent_accepted_at, consent_channel)` y se inserta `consent_events(event='accepted', channel, notice_version, occurred_at)`.
- Si `consent_notice_version` no es la versión vigente, la persona solo puede leer el aviso, aceptarlo o revocar (ver abajo). Cualquier otra operación, incluida la exploración, responde 403 `consent_required` (HU-001, criterio 5; D-039).

**Prueba de autorización y revocación (D-036).**
- `consent_events(id, event ∈ {accepted, revoked}, channel ∈ {bot, mini_app}, notice_version, occurred_at)`. No tiene columna de ID de Telegram, pseudónimo, HMAC, cuenta ni número de identidad. El rol `eje_app` solo puede hacer `INSERT` y `SELECT` sobre ella.
- Mientras la cuenta existe, la constancia de la persona está en `accounts`: versión, fecha y canal de la aceptación vigente. Tras revocar, solo quedan las filas anónimas de `consent_events`.
- Consecuencia aceptada por la usuaria (D-036): después de revocar, la prueba no se puede atribuir a una persona concreta.

**ID de Telegram de administradores autorizados (D-037).**
- `authorizeAdministrator` guarda `role_grants(telegram_user_id, role='admin', granted_by_account_id, granted_at)` aunque esa persona aún no tenga cuenta. Es la única escritura con un ID de Telegram de alguien que no aceptó el aviso, y el aviso la menciona (D-037; cambio de texto para el product-manager).
- Al abrir el bot, la persona autorizada ve primero el aviso (D-039). Solo después de aceptar ve el menú de administrador. El permiso no habilita ninguna operación sin cuenta.
- Si la persona revoca su autorización, se borran todas sus filas de `role_grants`, activas o revocadas (D-020).

**Administrador y prestador no coexisten (D-038).**
- Servicio: `createProviderRegistration` responde 403 `admin_cannot_register_as_provider` si el actor tiene un permiso `admin` activo o es el administrador principal. El bot no muestra la opción de registro a un administrador (HU-006, criterio 3).
- Base de datos: un disparador en `provider_registrations` (al insertar) y otro en `role_grants` (al insertar un permiso `provider`) rechazan la operación si ese `telegram_user_id` tiene un permiso `admin` activo. Así, aprobar un registro de una cuenta que en el intervalo se volvió administradora responde 409 `role_conflict`.
- El caso inverso (autorizar como administrador a un prestador activo o a alguien con registro pendiente) no lo decide D-038. Por defecto se rechaza con 409 `role_conflict`, que es lo más restrictivo y se puede cambiar con poco costo. Es **Inferido** y queda Pendiente en `docs/03-arquitectura.md`.

**Documento de identidad: tipo y número (D-046).**
- Formato (Confirmado, D-046): tipo `CC`, `CE`, `PPT` o `PA`, y número como texto. Los nombres que ve la persona (cédula de ciudadanía, cédula de extranjería, Permiso por Protección Temporal y pasaporte; HU-002, criterio 4) están aprobados (Confirmado, D-055). En el bot se acepta también la sigla escrita en minúsculas (Confirmado, D-055; ADR 0015).
- Tipo: columna `provider_registrations.identity_document_type`, de tipo enum de PostgreSQL `app.identity_document_type` con los valores `CC`, `CE`, `PPT` y `PA`, `NOT NULL`. La base rechaza cualquier otro valor aunque el servicio falle. Se guarda sin cifrar porque es un código de una lista cerrada y la base necesita validarlo. Aun así, solo lo ven los administradores, no aparece en ningún esquema público ni de prestador y no se registra en logs.
- Número: se guarda definitivamente solo en `identity_number_encrypted` (AES-256-GCM con la clave `IDENTITY_ENCRYPTION_KEY` y un IV aleatorio por registro) y en `identity_number_hash` (HMAC-SHA256 con `IDENTITY_HASH_KEY`), que sirve para detectar duplicados sin descifrar. Se cifra el número tal como lo escribió la persona, sin espacios al inicio ni al final.
- Validación: una función de dominio aislada, `validateIdentityNumber(documentType, number)`, usada por el bot y por la API antes de llamar al servicio. Devuelve los errores por campo:
  - tipo fuera de `CC`, `CE`, `PPT` y `PA`: `not_in_list` en `identityDocumentType`;
  - número vacío después de quitar los espacios del inicio y del final: `required` en `identityNumber`;
  - número con caracteres de control (categoría Unicode Cc): `invalid_format` en `identityNumber`.
  No aplica reglas de caracteres ni de longitud por tipo, porque D-046 no las fija. El máximo de 4096 caracteres es técnico (un mensaje de Telegram), no una regla del producto, y está aprobado (Confirmado, D-055). Si la usuaria agrega reglas por tipo, solo cambia esta función y su prueba.
- Normalización para el duplicado (Confirmado, D-055): quitar los espacios del inicio y del final y pasar las letras a mayúsculas, para que "ab123" y "AB123" cuenten como el mismo pasaporte. No se quitan puntos ni espacios internos, porque D-046 define el número como texto.
- Regla de duplicado (Confirmado, D-054): compara **tipo y número**. El hash se calcula como `HMAC(IDENTITY_HASH_KEY, tipo + ":" + número normalizado)`. Así "CC 123" y "CE 123" son registros distintos, y "CC 123" repetido es duplicado (F002, paso 6). Lo protege el índice único parcial sobre `identity_number_hash` para registros `pending` o `approved`. El hash se arma en una sola función de dominio, con su prueba.
- Durante el formulario del bot, el tipo elegido queda en `draft` como uno de los cuatro códigos. El número, entre su mensaje y el botón "Confirmar", está en la sesión **solo sellado**: cifrado con la misma clave AES-256-GCM, con la cuenta y el formulario como datos asociados, y con vencimiento propio. Nunca está en claro en `bot_sessions` (ADR 0015).
- Solo el servicio de revisión de registros descifra el número para mostrarlo, junto con el tipo, y solo para un actor `admin` (D-011). Ningún otro esquema de respuesta incluye el tipo ni el número.
- El logger redacta siempre las claves `identityNumber`, `identityDocumentType`, `identity_number*`, `identity_document_type`, `sealedIdentity*`, `initData`, `authorization`, `text`, `message` y `data` de la sesión. Los manejadores del bot nunca registran el cuerpo de la actualización. Los mensajes de error no repiten lo que escribió la persona.

**Revocación ("Revocar mi autorización", D-018).**
- Quién puede: cualquier persona con cuenta, haya aceptado la versión vigente o una anterior. HU-030, criterio 1, habla de "un usuario que aceptó el aviso" y no exige la versión vigente. Revocar no obliga a aceptar primero la versión nueva. En el contrato, el rol se llama `account_holder`.
- Dónde aparece: en B02 y M02 para cuentas con la versión vigente. Para cuentas con una versión anterior, en B01 y M01, junto al aviso nuevo: "Acepto", "No acepto" y "Revocar mi autorización", con la frase de D-023. Mostrar el botón en el aviso es **Inferido** (Pendiente). Para esas cuentas, "No acepto" no cambia nada de lo guardado; solo impide seguir.
- Un servicio único, usado por el bot y por la Mini App, en una transacción con bloqueo de la cuenta:
  1. Si el actor es el administrador principal o el único administrador activo, responde 409 `principal_admin_protected` o `last_admin_protected`, sin cambios (D-020, D-032).
  2. Solicitudes que la persona envió como visitante: se encola un aviso al prestador de cada una y se borran (D-019).
  3. Si es prestador: se encola un aviso al visitante de cada solicitud recibida por sus negocios y se borran (D-029). Se borra su registro, con el tipo y el número de documento, y por cascada sus permisos `provider` (FK `role_grants.provider_registration_id` con `ON DELETE CASCADE`). `businesses.provider_account_id` queda nulo y las fichas no cambian de estado (D-029).
  4. Se borran todas las filas de `role_grants` con su `telegram_user_id`, incluidos los permisos `admin` (D-020).
  5. Se inserta `consent_events(event='revoked', channel, notice_version, occurred_at)`, sin identificador (D-036).
  6. Se borra la cuenta. Por cascada se borran la sesión del bot, los contadores de límites y los datos dependientes. En los registros de trazabilidad, el responsable queda nulo (`ON DELETE SET NULL`) y el rol se conserva como texto, de modo que se muestra "Usuario eliminado" (Inferido, Pendiente).
  7. Después de confirmar la transacción, se envían los avisos encolados (ADR 0007).
- Después, la persona vuelve a ver el aviso al abrir el bot o la Mini App, sin que se le pida ningún código (D-018).

**Consultas y correcciones.** No hay endpoint ni opción para consultar o corregir datos personales. Se atienden por correo y teléfono (D-025, RNF-022).

**Eliminación del 31 de enero de 2027 (D-021, D-043).** Ver ADR 0007. El plazo para los datos recogidos después de esa fecha se decide antes de ella; si el sistema sigue en uso, se publica una versión nueva del aviso con el plazo nuevo (D-051).

## Alternativas consideradas
| Alternativa | A favor | En contra |
| --- | --- | --- |
| Número de identidad en claro con acceso restringido | Simple | Cualquier volcado de la base o error de consulta lo expone |
| Cifrado con la extensión `pgcrypto` en la base | Sin código de cifrado en la aplicación | La clave viajaría en las consultas SQL y podría quedar en registros de la base |
| Prueba de consentimiento con un pseudónimo (HMAC) del ID (diseño anterior) | La prueba se puede atribuir a una persona | Descartada por D-036 |
| Pedir el número de identidad después de pulsar "Confirmar", para no guardarlo entre pasos | No hay nada sellado en la sesión | Rompe el orden de F002, paso 3 (primero el número, luego la confirmación) y el invariante 8 (se confirmaría algo que aún no se ha escrito) |
| Número en claro en la sesión hasta confirmar (diseño anterior) | Simple | Contradice "se guarda solo cifrado" (hallazgo M-06) |
| Tipo de documento cifrado junto con el número | El tipo tampoco queda legible en un volcado | La base no puede validar la lista de D-046, y el administrador no podría filtrar por tipo sin descifrar. El tipo solo no identifica a la persona |
| Tipo de documento como texto con CHECK en lugar de enum | Agregar un tipo es un cambio de CHECK | Equivalente en protección; se elige el enum porque `kysely-codegen` lo convierte en un tipo unión de TypeScript |
| Duplicado solo por número (descartada por D-054) | Detecta el caso de una persona que se registra con dos tipos de documento y el mismo número | Rechaza a dos personas distintas cuyos documentos de tipos distintos coinciden en el número |

## Consecuencias
- Más fácil: un volcado de la base no expone números de identidad sin la clave. La revocación es atómica (todo o nada). Ningún dato de quien no aceptó queda guardado, salvo el ID del administrador autorizado (D-037).
- Más difícil: rotar `IDENTITY_ENCRYPTION_KEY` exige volver a cifrar. Si se pierde la clave, los números quedan ilegibles.
- Tras revocar, la prueba de autorización y revocación no identifica a la persona (D-036).
- El mensaje de Telegram en el que la persona escribe su número queda en el historial de su chat, que gestiona Telegram (aviso, apartado 5).
- F002, paso 2, ya tiene criterio de aprobación: tipo fuera de la lista o número vacío responden 422 sin crear registro (D-046).
- El tipo de documento se guarda sin cifrar. Un tipo como PPT revela la situación migratoria de la persona; por eso solo lo ven los administradores y el logger lo redacta.
