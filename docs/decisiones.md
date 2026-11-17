# Registro de decisiones (congelado)

Solo se agregan filas al final, con `>>`. Ninguna fila se edita, se borra ni se reemplaza; un hook lo impide. Si una tarea contradice una decisión, el agente se detiene y lo reporta. Solo la usuaria puede cambiar este archivo, a mano y fuera de los agentes.

| Id | Fase | Ronda | Decisión | Fecha |
| --- | --- | --- | --- | --- |
| D-001 | 1 | 1 | Compuerta 1 aprobada: brief, requisitos y feature_list.json (33 funcionalidades) | 2026-11-14 |
| D-002 | 1 | 1 | P1: el bot lleva privacidad, registro, exploración, solicitudes y aprobaciones; la Mini App lleva el catálogo con fotos y los formularios largos de fichas | 2026-11-14 |
| D-003 | 1 | 1 | P2: campos obligatorios de ficha = nombre, municipio, categoría, descripción, horarios, contacto y enlace de Maps; duplicado = mismo nombre en el mismo municipio | 2026-11-14 |
| D-004 | 1 | 1 | P3: categorías y tipos de experiencia son listas cerradas administradas por el administrador; restaurante y café son tipos de establecimiento | 2026-11-14 |
| D-005 | 1 | 1 | P4: el administrador registra atractivos y eventos, sin validación | 2026-11-14 |
| D-006 | 1 | 1 | P5: un prestador puede tener varios negocios | 2026-11-14 |
| D-007 | 1 | 1 | P6 y P7: el administrador no se registra con número de identidad; el primer administrador se fija por su ID de Telegram en la configuración de la publicación | 2026-11-14 |
| D-008 | 1 | 1 | P8: si no se acepta el aviso de privacidad no se guarda ningún dato; la usuaria redacta el texto (borrador entregado el 2026-11-14) | 2026-11-14 |
| D-009 | 1 | 1 | P9: reportes básicos = fichas por estado y municipio, y solicitudes por estado | 2026-11-14 |
| D-010 | 1 | 1 | P10: el nombre de la solicitud se toma de Telegram y se puede cambiar; la respuesta del prestador es texto libre | 2026-11-14 |
| D-011 | 1 | 1 | P11: el número de identidad solo lo ven administradores; los datos de una solicitud solo los ve el prestador del negocio | 2026-11-14 |
| D-012 | 1 | 1 | P12: recortables si hace falta = Mini App del visitante, eventos y reportes; fecha de entrega la indica la usuaria (Pendiente) | 2026-11-14 |
| D-013 | 1 | 1 | P13 y P14: límites de fotos, tamaños y caracteres, y municipios iniciales los indica la usuaria (Pendiente); zona es dato opcional, no entidad | 2026-11-14 |
| D-014 | 1 | 1 | P15, P17 y P18: fuera de esta entrega despublicar o eliminar fichas y notificaciones de eventos; los guías no son usuarios, solo datos de la ficha | 2026-11-14 |
| D-015 | 1 | 1 | P16: el administrador puede revocar una autorización, con confirmación | 2026-11-14 |
| D-016 | 1 | 1 | P19: prioridades aprobadas, subiendo la consulta del visitante en el bot justo después de establecimientos | 2026-11-14 |
| D-017 | 1 | 2 | Prioridades: F020 y F021 suben a prioridad 5 para desbloquear F023 | 2026-11-14 |
| D-018 | 1 | 2 | Se agrega HU-030 y una funcionalidad de privacidad con prioridad 1 que depende de F001: "Revocar mi autorización", en el inicio del bot y de la Mini App; tras revocar se vuelve a aceptar el aviso | 2026-11-14 |
| D-019 | 1 | 2 | Al revocar: el prestador pierde número de identidad, registro y rol, y sus fichas publicadas siguen hasta el 31 de enero de 2027 (despublicar está fuera de alcance); el visitante conserva su uso y sus solicitudes se borran de inmediato, avisando al prestador | 2026-11-14 |
| D-020 | 1 | 2 | Un administrador que revoca pierde el rol, salvo el fijado en la configuración o el único administrador, que no pueden revocar; la opción del administrador de D-015 se llama "Revocar rol" | 2026-11-14 |
| D-021 | 1 | 2 | Eliminación de datos el 31 de enero de 2027, también para la prueba de autorización y revocación | 2026-11-14 |
| D-022 | 1 | 2 | El architect confirma la región de los servidores de los proveedores antes de decidir si el aviso menciona transferencia internacional | 2026-11-14 |
| D-023 | 1 | 2 | Frase junto a la revocación: "El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador" | 2026-11-14 |
| D-024 | 1 | 2 | El prestador declara tener la autorización de guías y contactos al enviar la ficha | 2026-11-14 |
| D-025 | 1 | 2 | Cambio de versión del aviso: se pide aceptar de nuevo; quien entra primero por la Mini App ve el mismo aviso; consultas y correcciones solo por correo y teléfono | 2026-11-14 |
| D-026 | 1 | 2 | Fecha de entrega: 26 de noviembre de 2026 | 2026-11-14 |
| D-027 | 1 | 2 | Municipios iniciales: Manizales, Supía y Filadelfia, departamento de Caldas | 2026-11-14 |
| D-028 | 1 | 2 | Límite de fotos dado por la usuaria: 10 fotos por "solicitud" y máximo 2 GB; el alcance exacto queda Pendiente para la ronda 3 | 2026-11-14 |
| D-029 | 1 | 3 | P20: al revocar un prestador, sus fichas no publicadas quedan como están y sin ser visibles; las solicitudes recibidas se borran y se avisa al visitante; las fichas publicadas dejan de ofrecer "Solicitar información" | 2026-11-14 |
| D-030 | 1 | 3 | P22: recortes de D-012 aplicados: F026, F019 y F025 salen de esta entrega y no se crea la funcionalidad de reportes | 2026-11-14 |
| D-031 | 1 | 3 | Límite de fotos (aclara D-028): 10 fotos por ficha enviada a aprobación y tope de 2 GB en total por ficha; el architect verifica la viabilidad con los límites de Vercel | 2026-11-14 |
| D-032 | 1 | 3 | El administrador fijado en la configuración se llama "administrador principal" en los textos al usuario | 2026-11-14 |
| D-033 | 1 | 3 | Pendiente sin respuesta tras la ronda 3: formato del número de identidad y demás pendientes del aviso (bloquea F002) | 2026-11-14 |
| D-034 | 3 | 1 | Se aprueba el texto del aviso de privacidad propuesto, que menciona la transferencia internacional de datos (los proveedores guardan datos fuera de Colombia) | 2026-11-14 |
| D-035 | 3 | 1 | Regiones sa-east-1 (Supabase) y gru1 (Vercel y Vercel Blob); planes Vercel Hobby y Supabase Free; dos bots en BotFather, desarrollo (también vista previa) y producción | 2026-11-14 |
| D-036 | 3 | 1 | La prueba de autorización y revocación guarda solo fecha, canal y versión del aviso; no se conserva ningún pseudónimo del ID de Telegram | 2026-11-14 |
| D-037 | 3 | 1 | El ID de Telegram de un administrador autorizado se guarda antes de que acepte el aviso, y el aviso lo menciona | 2026-11-14 |
| D-038 | 3 | 1 | Una cuenta con rol de administrador no puede registrarse también como prestador | 2026-11-14 |
| D-039 | 3 | 1 | El aviso de privacidad se acepta antes de cualquier uso del bot, incluida la exploración de fichas | 2026-11-14 |
| D-040 | 3 | 1 | Tipo de establecimiento: opcional al enviar a revisión; lista cerrada administrada por el administrador con hotel, finca cafetera, alojamiento rural, restaurante y café; el directorio gastronómico son restaurante y café | 2026-11-14 |
| D-041 | 3 | 1 | Los municipios y las listas cerradas se gestionan en la Mini App | 2026-11-14 |
| D-042 | 3 | 1 | Límites: 5 MB por foto, cuota global de 900 MB; caracteres: nombre 100, descripción 1500, horarios 300, contacto 200 (cifras propuestas, aprobadas por la usuaria) | 2026-11-14 |
| D-043 | 3 | 1 | Eliminación del 31 de enero de 2027: se borran cuentas, consentimientos, registros, solicitudes, auditoría y fichas de prestadores con sus fotos; se conservan municipios, listas cerradas y atractivos. "Revocar rol" a un prestador solo le quita el rol y sus fichas publicadas dejan de aceptar solicitudes nuevas | 2026-11-14 |
| D-044 | 3 | 1 | Se aprueban en conjunto las reglas Inferidas del Pendiente 22 de la arquitectura y las herramientas de la ADR 0014 | 2026-11-14 |
| D-045 | 3 | 1 | El formato del número de identidad sigue Pendiente (sin respuesta de la usuaria en la ronda 1 de la fase 3) | 2026-11-14 |
| D-046 | 3 | 2 | Formato del número de identidad: texto (VARCHAR/String) con tipos CC, CE, PPT y PA; cierra D-045 | 2026-11-14 |
| D-047 | 3 | 2 | Se confirma D-038 (una cuenta administradora no se registra como prestador); coincide con D-007 y no exige cambios en los documentos | 2026-11-14 |
| D-048 | 3 | 2 | Se agrega a la semilla un tipo de experiencia gastronómica marcado is_gastronomic (cumple la sección 3.4); D-040 queda como la lista de tipos de establecimiento del directorio. El nombre del tipo queda Pendiente | 2026-11-14 |
| D-049 | 3 | 2 | Se aprueba que el product-manager redacte el texto del aviso 2.5, paralelo al 2.4 | 2026-11-14 |
| D-050 | 3 | 2 | Versión del aviso "2026-11-v3", vigente desde la fecha de publicación en producción, porque el texto cambió después de la v2 (D-034, D-037 y D-039) | 2026-11-14 |
| D-051 | 3 | 2 | Plazo de eliminación posterior al 31 de enero de 2027: se decide antes de esa fecha; si el sistema sigue en uso, se publica una versión nueva del aviso con el plazo nuevo. No bloquea la entrega del 26 de noviembre de 2026 | 2026-11-14 |
| D-052 | 3 | 3 | Nombre del tipo de experiencia gastronómica (is_gastronomic): "Sabores de Caldas"; cierra el Pendiente de D-048 | 2026-11-14 |
| D-053 | 3 | 3 | Mientras el nombre sea un marcador, la fila se omite en producción; con D-052 la semilla carga "Sabores de Caldas" | 2026-11-14 |
| D-054 | 3 | 3 | El duplicado del registro compara tipo y número de documento | 2026-11-14 |
| D-055 | 3 | 3 | Se aprueban los valores Inferidos nuevos (Pendiente 8): normalizar número (sin espacios en los extremos, letras en mayúsculas), nombres visibles de las siglas, sigla aceptada en minúsculas y máximo técnico de 4096 caracteres | 2026-11-14 |
| D-056 | 3 | 3 | El aviso, apartado 2, dice "tu tipo y número de documento de identidad", dentro de la versión "2026-11-v3" | 2026-11-14 |
| D-057 | 3 | 3 | Se aprueba el texto del apartado 2.5 del aviso: "Una solicitud que enviaste ya no está disponible porque el prestador que la recibió retiró su autorización." | 2026-11-14 |
| D-058 | 3 | 3 | F017 depende de F018; se intercambian prioridades (F018 pasa a 6 y F017 a 7) | 2026-11-14 |
| D-059 | 3 | 3 | Sin respuesta tras la ronda 3: el resto del antiguo Pendiente 8 de la arquitectura (ahora Pendiente 6) queda como Pendiente Inferido, no bloqueante | 2026-11-14 |
| D-060 | 3 | 3 | Compuerta 2 aprobada: readiness PASS (docs/04-readiness.md); se pasa a la fase 4 | 2026-11-14 |
| D-061 | 4 | 1 | Se agrega /api/health al contrato api/openapi.yaml | 2026-11-15 |
| D-062 | 4 | 1 | TypeScript se queda en 5.x (openapi-typescript 7.13 falla con la 7) | 2026-11-15 |
| D-063 | 4 | 2 | Base local de desarrollo y pruebas: PostgreSQL instalado con Homebrew en lugar de Docker; cambia lo que dice la ADR 0014 sobre Docker | 2026-11-15 |
| D-064 | 4 | 2 | /api/health queda solo como prueba de vida; el architect anota D-062 (TypeScript 5.x) en la ADR 0014 | 2026-11-15 |
| D-065 | 4 | 3 | Se aprueban las recomendaciones del architect (Pendiente 7): PostgreSQL 17, autenticación local trust solo en localhost, contraseña de eje_app fijada por la usuaria fuera del repositorio y solo en DATABASE_URL de Vercel, y los nombres propuestos de scripts y variables locales | 2026-11-15 |
| D-066 | 5 | 1 | F001: el aviso se envía en 3 mensajes consecutivos partidos por apartados completos (límite de 4096 caracteres de Telegram), con los botones "Acepto" y "No acepto" solo en el último | 2026-11-15 |
| D-067 | 5 | 1 | F001: "No acepto" usa el texto del apartado 2.1 de docs/05-aviso-privacidad.md, ofrece "Volver a ver el aviso" y no guarda ningún dato | 2026-11-15 |
| D-068 | 5 | 1 | F001: B02 es un menú mínimo con bienvenida y lista de comandos disponibles, sin opciones de rol | 2026-11-15 |
| D-069 | 5 | 1 | F001: "Revocar mi autorización" en B01 queda fuera (es de F034); riesgo anotado: el apartado 9 del aviso solo se publica en producción cuando F034 exista | 2026-11-15 |
| D-070 | 5 | 1 | F001: incluye las rutas HTTP y la autenticación por initData (getMe), sin la pantalla M01 | 2026-11-15 |
| D-071 | 5 | 2 | F001: texto de B02 aprobado: "Te damos la bienvenida a Eje Turismo. Comandos disponibles: /start: mostrar este menú" | 2026-11-15 |
| D-072 | 5 | 2 | F001: aviso repartido en 3 mensajes: título y apartados 1 a 4; apartados 5 a 9; apartados 10 a 13 y declaración con los botones | 2026-11-15 |
| D-073 | 5 | 2 | F001: la fecha en America/Bogota no se muestra en ninguna pantalla; se guarda en UTC y se prueba formatBogota y el ISO UTC de getMe | 2026-11-15 |
| D-074 | 5 | 1 | F002: B02 muestra un botón en línea "Registrarme como prestador" solo a cuentas sin rol y sin registro previo; sustituye a D-068 y D-071 únicamente en lo del teclado de B02 y cambia los criterios 10 y 14 de F001 | 2026-11-15 |
| D-075 | 5 | 1 | F002: el developer propone los textos exactos de B04 y B05 en el contrato y la usuaria los aprueba antes de implementar; el paso 5 se prueba con el guardián de rol sobre una ruta de prueba | 2026-11-15 |
| D-076 | 5 | 1 | F002: la creación del registro de prestador se registra en audit_events | 2026-11-15 |
| D-077 | 5 | 1 | F002: límite de 5 registros por hora, leído de RATE_LIMITS | 2026-11-15 |
| D-078 | 5 | 1 | F002: IDENTITY_ENCRYPTION_KEY e IDENTITY_HASH_KEY en base64 de 32 bytes | 2026-11-15 |
| D-079 | 5 | 2 | F002: se aprueban los textos de B04 y B05 de contracts/F002.md, "Textos propuestos", sin la frase "Te avisaremos cuando haya una decisión" en provider.pending (depende de F003) | 2026-11-15 |
| D-080 | 5 | 2 | F002: el bot no borra el mensaje con el número de identidad en el chat (sin deleteMessage) | 2026-11-15 |
| D-081 | 5 | 2 | F002: actor_role='none' en la auditoría de quien se registra sin rol | 2026-11-15 |
| D-082 | 5 | 2 | F002: al límite de 5 registros por hora suman los éxitos, los 409 y los 500; no suman 401, 403, 422 ni 429 | 2026-11-15 |
| D-083 | 5 | 1 | F028: se aprueban los textos nuevos common.nothingToCancel, common.useButtons y common.sessionConflict propuestos en contracts/F028.md | 2026-11-15 |
| D-084 | 5 | 1 | F028: botón "Cancelar" en los pasos de tipo y número del formulario; cambia los criterios 4, 6 y 10 de F002, que se ajustan explícitamente | 2026-11-15 |
| D-085 | 5 | 1 | F028: ante un choque de sesión el bot muestra common.sessionConflict y repite el paso (ADR 0015) | 2026-11-15 |
| D-086 | 5 | 1 | F028: provider.error solo si falla createProviderRegistration al confirmar; errors.generic en cualquier otro fallo | 2026-11-15 |
| D-087 | 5 | 1 | F028: cancelar sin formulario en curso responde common.nothingToCancel | 2026-11-15 |
| D-088 | 5 | 1 | F028: un mensaje que no es texto cuando se espera un botón repite el paso con common.useButtons | 2026-11-15 |
| D-089 | 5 | 1 | F028: /cancelar funciona siempre pero no se agrega a BOT_COMMANDS ni al texto de B02 (D-071) | 2026-11-15 |
| D-090 | 5 | 1 | F003: se aprueban los textos de B06, B07 y B20 y menu.providerAvailable propuestos en contracts/F003.md | 2026-11-15 |
| D-091 | 5 | 1 | F003: el menú de prestador es mínimo (Registros pendientes para administradores y menu.providerAvailable para prestadores); el menú completo es de F005 | 2026-11-15 |
| D-092 | 5 | 1 | F003: el motivo del rechazo no se pide en el bot; la API lo acepta opcional y no se envía a la persona | 2026-11-15 |
| D-093 | 5 | 1 | F003: no se construye la tarea diaria cron/outbox de reintento; riesgo anotado: una notificación fallida no se reintenta hasta que exista | 2026-11-15 |
| D-094 | 5 | 1 | F003: si una cuenta rechazada puede volver a registrarse por HTTP queda para decidirse en F005; en el bot no ve el botón | 2026-11-15 |
| D-095 | 5 | 1 | F003: la lista de registros va del más antiguo al más reciente y, sin status, trae todos los estados | 2026-11-15 |
| D-096 | 5 | 2 | F003: el bot envía como máximo 10 registros pendientes por pulsación y, si hay más, el mensaje admin.morePending propuesto en contracts/F003.md | 2026-11-15 |
| D-097 | 5 | 2 | F003: orden de comprobaciones 409: primero invalid_state_transition y luego role_conflict; rechazar el registro de una cuenta con permiso admin responde 200 | 2026-11-15 |
| D-098 | 5 | 2 | F003: un reason vacío o solo de espacios se guarda como nulo | 2026-11-15 |
| D-099 | 5 | 2 | F028: /CANCELAR y /cancelar@otro_bot se aceptan como número de identidad en el paso del número; no cambia la validación de F002 | 2026-11-15 |
| D-100 | 5 | 2 | F028: un mensaje no textual en los pasos del tipo y del número se trata como entrada inválida y repite el paso | 2026-11-15 |
| D-101 | 5 | 1 | F004 P1: la fila is_principal se crea al aceptar el aviso y en el siguiente /start si falta; el guardián reconoce al principal por la configuración | 2026-11-15 |
| D-102 | 5 | 1 | F004 P2: B06 agrega Autorizar administrador como segundo botón y se actualizan las 4 aserciones de pruebas del criterio 36 | 2026-11-15 |
| D-103 | 5 | 1 | F004 P3: se aprueban los textos nuevos de B06 y B08 propuestos en contracts/F004.md | 2026-11-15 |
| D-104 | 5 | 1 | F004 P4: listRoleGrants queda en F006, no en F004 | 2026-11-15 |
| D-105 | 5 | 1 | F004 P5: traza role_grant.admin_authorized, entity_type role_grant, actor_role admin, sin datos personales en details | 2026-11-15 |
| D-106 | 5 | 1 | F004 P6: role_conflict con permiso provider activo o registro pending; rejected o permiso revocado no bloquea; no se avisa a la persona autorizada | 2026-11-15 |
| D-107 | 5 | 1 | F004 P7: el ID sigue el patrón ^[1-9][0-9]{0,15}$ y el bot ignora espacios al inicio y al final | 2026-11-15 |
| D-108 | 5 | 1 | F004 P8: orden 401, 403 consent_required, 403 forbidden, 422, 409 duplicate, 409 role_conflict; un permiso admin revocado no cuenta como duplicado | 2026-11-15 |
| D-109 | 5 | 1 | F004 P9: si cambia PRINCIPAL_ADMIN_TELEGRAM_ID el nuevo entra por configuración y la fila del anterior no se toca; riesgo anotado | 2026-11-15 |
| D-110 | 5 | 1 | F004 P10: sin postgresql@17 local las pruebas de integración se reportan como bloqueo (FALLA), no como éxito | 2026-11-15 |
| D-111 | 5 | 1 | F004 P11: la sesión de B08 vence a los 600 s (ADR 0015) y pulsar Autorizar administrador con otro formulario abierto la reemplaza sin copiar el borrador | 2026-11-15 |
| D-112 | 5 | 1 | F005 P1: la Mini App en F005 solo tiene M02 y M12 mínimas, con aviso corto si falta aceptar el aviso de privacidad; el texto lo propone el contrato y queda pendiente de aprobación de la usuaria | 2026-11-16 |
| D-113 | 5 | 1 | F005 P2: el administrador conserva sus 2 botones y el prestador sigue con menu.providerAvailable hasta que existan las demás opciones | 2026-11-16 |
| D-114 | 5 | 1 | F005 P3: quien no tiene rol ve solo el botón de registro como prestador hasta F022 | 2026-11-16 |
| D-115 | 5 | 1 | F005 P4: el botón de registro tras un rechazo (D-094) se habilita también en el bot | 2026-11-16 |
| D-116 | 5 | 1 | F005 P5: si una cuenta tiene permisos de administrador y de prestador a la vez, prevalece el administrador | 2026-11-16 |
| D-117 | 5 | 1 | F005: aprobados los textos nuevos de la Mini App (sección Textos nuevos de la Mini App de contracts/F005.md) | 2026-11-16 |
| D-118 | 5 | 1 | F010 P6 y F011 P1: el nombre se normaliza para detectar duplicados recortando espacios, juntando los repetidos, pasando a minúsculas y quitando tildes (Inferido, aprobado) | 2026-11-16 |
| D-119 | 5 | 1 | F011 P1: el nombre de categorías y tipos tiene máximo 100 caracteres, igual que el nombre de ficha (D-042) | 2026-11-16 |
| D-120 | 5 | 1 | F010 P2 y F011 P5: el inicio del administrador en la Mini App agrega un enlace a M10 y otro a M11, se mantiene el texto de D-117 y se ajusta una aserción de F005 sin borrar pruebas; los textos nuevos requieren aprobación de la usuaria | 2026-11-16 |
| D-121 | 5 | 1 | F011 P3: crear y editar categorías y tipos se registra en audit_events sin datos personales (precedente D-076) | 2026-11-16 |
| D-122 | 5 | 1 | F010 P1, P3, P5, P7 y P8: department se precarga con Caldas, límite de 4096 caracteres también en PATCH, lista en orden alfabético, PATCH sin campos responde 200 sin cambios y no hay datos de prueba en producción | 2026-11-16 |
| D-123 | 5 | 1 | F011 P4 y P7: se siembra solo Sabores de Caldas (D-052) y los tipos de establecimiento de D-040, y F011 incluye los endpoints de tipos de establecimiento | 2026-11-16 |
| D-124 | 5 | 1 | F011 P2: F011 verifica listas y una tabla de prueba; la verificación de extremo a extremo se exige en los contratos de F012 y F013 y se anota en progress.md | 2026-11-16 |
| D-125 | 5 | 1 | F006 P1 opción a: se ajusta ahora el texto de la Mini App para el prestador revocado (texto por aprobar) y la reautorización por el administrador queda para otra funcionalidad | 2026-11-16 |
| D-126 | 5 | 1 | F006 P2 y P4: F006 agrega y prueba assertProvider a nivel de servicio; la ruta HTTP y el efecto de D-043 sobre las fichas se verifican en F013, F023 | 2026-11-16 |
| D-127 | 5 | 1 | F006 P3, P5, P6 y P7: no se avisa a la persona afectada, lista del bot de 8 por página con Ver más incluida la propia cuenta, revocar un permiso ya revocado o inexistente responde 404 not_found y traza role_grant.revoked con la forma de D-105 | 2026-11-16 |
| D-128 | 5 | 2 | F006: aprobados los textos nuevos del bot y de la Mini App (tablas Textos nuevos de contracts/F006.md) y que el prestador revocado reciba en el bot solo menu.welcome sin botones (criterio 17) | 2026-11-16 |
| D-129 | 5 | 2 | F010: aprobados los textos nuevos de la Mini App, incluido el enlace Administrar municipios (tabla Textos nuevos de contracts/F010.md) | 2026-11-16 |
| D-130 | 5 | 2 | F011: aprobados los textos nuevos de la Mini App, incluido el enlace Categorías y tipos (tabla Textos nuevos de contracts/F011.md) | 2026-11-16 |
| D-131 | 5 | 1 | Para reducir gasto: agrupar funcionalidades parecidas en un mismo lote (tras confirmar independencia en la trazabilidad) y pedir que el contrato traiga los textos nuevos de una vez, sin versión extra por ese motivo | 2026-11-16 |
| D-132 | 5 | 1 | Aprobado el orden de trabajo: F034, F009, F007 y F008 de una en una con el ciclo normal (no en paralelo); después revisar F012 y F013 para un posible lote; el botón de editar en M11 queda como está | 2026-11-16 |
| D-133 | 5 | 1 | F034 P1 a P5 en la opción recomendada: sin botón para cuentas con rol activo (409 has_active_role y selfRevoke.blocked hasta F035), botón en B01 para F036, borrado con solicitudes en F037, el registro de prestador y role_grants de la cuenta sin rol se borran al revocar y no se escribe en audit_events (D-036) | 2026-11-17 |
| D-134 | 5 | 1 | F034: aprobados los textos nuevos (tabla Textos nuevos de contracts/F034.md, incluido selfRevoke.activeRole y la composición del menú de cuenta sin rol) | 2026-11-17 |
| D-135 | 5 | 1 | Primera prueba con Telegram real y primer despliegue (bots de BotFather, Supabase, Vercel y pnpm bot:set-webhook) al terminar F036, antes de continuar con las siguientes funcionalidades | 2026-11-17 |
| D-136 | 5 | 1 | F009 P1 a P6 en la opción recomendada: initData vigente 24 h, tolerancia de 60 s hacia el futuro, mismo 401 y mismo detalle para toda causa de rechazo, solo HMAC sin firma Ed25519, las rutas de F012 en adelante se agregan a la matriz de pruebas de F009 y solo se acepta el esquema tma en minúscula | 2026-11-17 |
| D-137 | 5 | 1 | F007 P1 a P5 en la opción recomendada: el paso de crear una ficha se verifica a nivel de guardián con rutas de muestra solo en tests y F007 puede pasar con cobertura diferida; los contratos de F012 y F013 incluyen el criterio literal de createListing con A1 a A5 e instantánea sin cambios; la persona sin cuenta recibe 403 consent_required por HTTP; en el bot A1 y A3 reciben el aviso y A2 y A4 es.admin.forbidden; el prestador activo queda para F008; la instantánea incluye todas las tablas salvo processed_updates en el bot para A2 y A4 | 2026-11-17 |
| D-138 | 5 | 1 | F008 P1 a P5 en la opción recomendada: el paso de aprobar su propia ficha se verifica con el caso análogo del registro propio y una ruta de muestra solo en tests, F008 puede pasar con cobertura diferida a F014 y el contrato de F014 incluye el criterio literal de approveListingVersion con prestador activo; se incluye al prestador con aviso anterior (A6b); la lista de 14 callbacks pasa a un helper compartido con F007 como refactor puro; el prestador de prueba es 900007031; el administrador frente a operaciones solo de prestador queda en F013 | 2026-11-17 |
| D-139 | 5 | 1 | F035 P1 a P9 en la opción recomendada: botón visible a todos los roles con bloqueo al pulsar y repetido en el backend; único administrador = una sola fila activa en role_grants (principal sin fila no cuenta); se borran los avisos pendientes en notification_outbox; claves a NULL y filas de otros se conservan; selfRevoke.revoked igual para ambos roles; sin escribir en audit_events; se retira has_active_role y el architect actualiza openapi y arquitectura; no se avisa a otros administradores; texto propio selfRevoke.confirmProviderAdmin para cuenta con ambos roles | 2026-11-17 |
| D-140 | 5 | 1 | F035: aprobados los textos nuevos (tabla Textos nuevos de contracts/F035.md, incluidos selfRevoke.confirmProvider, confirmAdmin, confirmProviderAdmin, principalProtected, lastAdminProtected y la composición del menú) | 2026-11-17 |
| D-141 | 5 | 1 | F036 P1 a P9 en la opción recomendada: aviso en texto plano con saltos de línea como en el bot; la Mini App explica el 409 de principal o único administrador al confirmar; selfRevoke.confirm para cuentas con versión anterior; tras revocar solo se muestra el resultado; botón de revocar en el tercer mensaje de B01 solo para versiones anteriores; el bot no repite el aviso tras aceptar en la Mini App; prueba con Telegram real tras la evaluación de QA (D-135); Cancelar en B01 responde selfRevoke.cancelled y reenvía el aviso | 2026-11-17 |
| D-142 | 5 | 1 | F036: aprobados los textos nuevos (tabla Textos nuevos de contracts/F036.md: miniapp.declined, miniapp.noticeError, miniapp.acceptError, resultado de M03 y composición de B01) y el retiro de miniapp.consentRequired | 2026-11-17 |
| D-143 | 5 | 1 | Aviso en el bot: títulos y línea de versión en negrita y apartados en un bloque plegable de Telegram ("leer más") con parse_mode HTML escapado, manteniendo los 3 mensajes de D-066 y D-072 con la declaración y los botones visibles; en el bot y en la Mini App se quitan "### " y "**" (tercera transformación del criterio 2 de contracts/F001.md); la frase de D-023 se muestra con punto final, igual que revocation_note | 2026-11-17 |
| D-144 | 5 | 1 | Confirmado por la usuaria: DATABASE_CA_CERT agregada en Vercel, Redeploy hecho y /start funciona; la prueba real con Telegram (D-135, P8) funciona | 2026-11-17 |
| D-145 | 5 | 1 | Se conserva has_active_role en el enum ErrorCode (D-139, P7); el developer regenera los tipos de api/openapi.yaml en un commit chore aparte, aunque toque schema.d.ts | 2026-11-17 |
