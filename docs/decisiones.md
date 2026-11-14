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
