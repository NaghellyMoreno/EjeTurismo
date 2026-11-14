# Requisitos: Eje Turismo

Fuentes: `docs/00-contexto-producto.md` (versión 1), `docs/01-brief.md` y el registro de decisiones congeladas (D-001 a D-045). Las preguntas "P<n>" remiten a la tabla de preguntas del brief; las decisiones "D-0XX", al registro.

Actualización 2026-11-14 (ronda 3): se aplicaron D-002 a D-016 donde faltaban y D-029 a D-032 (efectos de la revocación del prestador, recortes, límite de fotos y "administrador principal"). HU-013, HU-022, HU-023 y HU-029 quedan fuera de esta entrega (D-030).

Actualización 2026-11-14 (tras el informe de preparación): se aplican D-034 a D-045 (aviso aprobado, regiones, ID del administrador antes de aceptar, administrador no prestador, aviso antes de cualquier uso, tipos de establecimiento, catálogos en la Mini App, límites de fotos y caracteres, eliminación del 31 de enero de 2027 y "Revocar rol"). D-045 deja Pendiente el formato del número de identidad. Se agrega F038 (eliminación de datos, RNF-021).

Marcas: **Confirmado** sale del contexto o de una decisión congelada; **Inferido** requiere aprobación de la usuaria; **Pendiente** falta información. Cuando una historia mezcla estados, cada criterio lleva su marca.

Canal (Confirmado, D-002): el bot lleva privacidad, registro, exploración, solicitudes y aprobaciones; la Mini App lleva los formularios largos de fichas. El catálogo con fotos de la Mini App para el visitante queda fuera de esta entrega (D-030).

Textos al usuario: el administrador fijado en la configuración de la publicación se llama "administrador principal" (Confirmado, D-032).

## Historias de usuario

### Privacidad, registro y roles

### HU-001: Aceptar el aviso de privacidad
- **Historia:** Como usuario de Telegram (visitante, prestador o administrador), quiero leer y aceptar el aviso de privacidad y tratamiento de datos al empezar, para saber cómo se tratan mis datos.
- **Fuente:** sección 3.15
- **Criterios de aceptación:**
  1. Dado un usuario que abre el bot por primera vez, cuando inicia la conversación, entonces el bot muestra el aviso de privacidad con un botón para aceptarlo, antes de pedir o guardar cualquier dato personal. (Confirmado)
  2. Dado un usuario que acepta, cuando vuelve a abrir el bot, entonces no se le muestra el aviso de nuevo y queda registrada la fecha y hora de aceptación (America/Bogota). (Confirmado: aceptación, sección 3.15; registro de fecha, sección 3.12)
  3. Dado un usuario que no acepta, cuando intenta continuar, entonces el bot no guarda ningún dato y le explica que debe aceptar el aviso para seguir. (Confirmado, D-008)
  4. El texto del aviso es el de `docs/05-aviso-privacidad.md`, aprobado por la usuaria. (Confirmado, D-034; el texto del aviso al visitante del apartado 2.5 sigue Pendiente)
  5. Dado un usuario que aceptó una versión anterior del aviso, cuando se publica una versión nueva y vuelve a abrir el bot o la Mini App, entonces se le muestra el aviso nuevo y debe aceptarlo de nuevo antes de seguir. (Confirmado, D-025)
  6. Dado un usuario que entra por primera vez por la Mini App, cuando se carga, entonces ve el mismo aviso y la misma declaración que en el bot antes de cualquier otro paso. (Confirmado, D-025)
  7. Las consultas y correcciones de datos personales se atienden solo por correo electrónico y teléfono; el bot y la Mini App no ofrecen opción para consultarlos o corregirlos. (Confirmado, D-025)
- **Estado:** Confirmado (texto del apartado 2.5 del aviso Pendiente)

### HU-002: Registro inicial del prestador
- **Historia:** Como prestador turístico, quiero registrarme una sola vez con mi número de identidad, para quedar vinculado a mi ID de Telegram y esperar la autorización del administrador.
- **Fuente:** sección 2.3
- **Criterios de aceptación:**
  1. Dado un usuario que aceptó el aviso de privacidad, cuando elige registrarse como prestador e ingresa su número de identidad, entonces el bot pide confirmación y, al confirmar, queda un registro pendiente que vincula ese número con su ID de Telegram. (Confirmado)
  2. Dado un registro pendiente, cuando el prestador intenta usar funciones de prestador, entonces el bot le informa que su registro espera autorización y el backend no le permite operar como prestador. (Confirmado)
  3. Dado un número de identidad o un ID de Telegram ya registrado, cuando se intenta un nuevo registro con alguno de ellos, entonces el sistema lo rechaza con un mensaje claro y no crea un duplicado. (Confirmado, sección 3.12)
  4. Dado un número de identidad con formato inválido, cuando se envía, entonces el bot lo rechaza, explica el motivo y vuelve a pedirlo. (Confirmado: validación, sección 3.12; formato válido Pendiente, D-045)
  5. Dado un usuario que no aceptó el aviso de privacidad, cuando intenta registrarse, entonces no se le pide el número de identidad. (Confirmado, sección 3.15)
  6. El número de identidad solo lo ven los administradores. (Confirmado, D-011)
- **Estado:** Confirmado (criterio 4 Pendiente en el formato)

### HU-003: Autorizar o rechazar el registro de un prestador
- **Historia:** Como administrador, quiero revisar los registros pendientes de prestadores y autorizarlos o rechazarlos, para que solo quien yo autorice tenga rol de prestador.
- **Fuente:** secciones 2.3, 3.16
- **Criterios de aceptación:**
  1. Dado un administrador autorizado, cuando consulta en el bot los registros pendientes, entonces ve cada uno con su ID de Telegram, nombre de Telegram, número de identidad y fecha de registro. (Confirmado; número de identidad visible solo para administradores, D-011)
  2. Dado un registro pendiente, cuando el administrador lo autoriza y confirma, entonces el usuario obtiene el rol de prestador y recibe un mensaje del bot que se lo informa. (Confirmado: autorización; mensaje Inferido)
  3. Dado un registro pendiente, cuando el administrador lo rechaza y confirma, entonces el usuario no obtiene el rol y recibe un mensaje del bot que se lo informa. (Inferido)
  4. Cada autorización o rechazo queda registrada con fecha, administrador responsable y resultado. (Confirmado, sección 3.12)
- **Estado:** Confirmado (criterio 3 y mensaje del criterio 2 Inferido)

### HU-004: Autorizar a otro administrador
- **Historia:** Como administrador, quiero autorizar el ID de Telegram de otra persona como administrador, para compartir la gestión de la plataforma.
- **Fuente:** secciones 2.3, 3.16
- **Criterios de aceptación:**
  1. Dado un administrador autorizado, cuando ingresa un ID de Telegram para darle el rol de administrador y confirma, entonces esa persona, al abrir el bot, accede a las funciones de administrador. (Confirmado)
  2. Dado un ID que ya es administrador, cuando se intenta autorizar de nuevo, entonces el sistema informa que ya está autorizado y no crea un duplicado. (Confirmado, sección 3.12)
  3. El nuevo administrador no se registra con número de identidad: ni el bot ni la Mini App se lo piden. (Confirmado, D-007)
  4. El administrador principal es el que se fija por su ID de Telegram en la configuración de la publicación; al abrir el bot ve el menú de administrador sin registro previo. (Confirmado, D-007, D-032)
- **Estado:** Confirmado

### HU-005: Revocar el rol de un usuario autorizado ("Revocar rol")
- **Historia:** Como administrador, quiero revocar el rol de un administrador o prestador, para mantener al día los usuarios autorizados.
- **Fuente:** sección 2.3 ("gestiona usuarios autorizados"); D-015, D-020
- **Criterios de aceptación:**
  1. La opción del menú de administrador se llama "Revocar rol" y es distinta de "Revocar mi autorización" (HU-030). (Confirmado, D-020)
  2. Dado un usuario autorizado, cuando el administrador elige "Revocar rol" y confirma, entonces la siguiente operación de ese usuario como prestador o administrador es rechazada por el backend. (Confirmado, D-015)
  3. Dado el mensaje de confirmación, cuando el administrador cancela, entonces el usuario conserva el rol. (Confirmado, sección 3.12)
  4. La revocación queda registrada con fecha, responsable y usuario afectado. (Confirmado, sección 3.12)
  5. Un administrador no puede revocarse el rol a sí mismo si es el único administrador. (Confirmado, D-020)
  6. Nadie puede revocar el rol del administrador principal; el mensaje lo nombra "administrador principal". (Regla Inferida a partir de D-007 y D-020, pregunta 21 sin respuesta; nombre Confirmado, D-032)
  7. Dado un prestador, cuando el administrador le aplica "Revocar rol" y confirma, entonces solo pierde el rol y sus fichas publicadas dejan de aceptar solicitudes nuevas. (Confirmado, D-043)
- **Estado:** Confirmado (criterio 6 Inferido)

### HU-006: Ingresar sin repetir el registro
- **Historia:** Como prestador o administrador autorizado, quiero que el bot me reconozca por mi ID de Telegram, para entrar con facilidad sin repetir el registro.
- **Fuente:** sección 2.3
- **Criterios de aceptación:**
  1. Dado un prestador autorizado, cuando abre el bot, entonces ve su menú de prestador sin que se le pida de nuevo el número de identidad. (Confirmado)
  2. Dado un administrador autorizado, cuando abre el bot, entonces ve su menú de administrador. (Confirmado)
  3. Dado un usuario sin rol autorizado, cuando abre el bot, entonces solo ve las opciones de visitante y la opción de registrarse como prestador. (Inferido) Una cuenta con rol de administrador no puede registrarse también como prestador. (Confirmado, D-038)
  4. Dado un usuario que abre la Mini App, cuando se carga, entonces muestra las opciones que correspondan a su rol según el backend. (Inferido, sección 3.16)
- **Estado:** Confirmado (criterio 3 parcialmente Inferido; criterio 4 Inferido)

### Organización del contenido

### HU-007: Gestionar municipios
- **Historia:** Como administrador, quiero crear y editar municipios, para organizar el contenido turístico por territorio.
- **Fuente:** secciones 2.3, 3.1, 3.9
- **Criterios de aceptación:**
  1. Dado un administrador, cuando crea un municipio con su nombre e información general y confirma, entonces el municipio queda disponible para clasificar fichas y para la exploración del visitante. (Confirmado)
  2. Dado un municipio con el mismo nombre ya existente, cuando se intenta crear otro, entonces el sistema lo rechaza sin crear duplicado. (Confirmado, sección 3.12)
  3. Dado un municipio existente, cuando el administrador edita su información y confirma, entonces el cambio se refleja y queda registrado con fecha y responsable. (Confirmado, sección 3.12)
  4. Los municipios iniciales son Manizales, Supía y Filadelfia, del departamento de Caldas (Confirmado, D-027). "Zona" es un dato opcional del municipio, no una entidad (Confirmado, D-013).
- **Estado:** Confirmado

### HU-008: Gestionar categorías y tipos de experiencia
- **Historia:** Como administrador, quiero gestionar las categorías y los tipos de experiencia, para que el contenido se organice y el visitante pueda filtrarlo.
- **Fuente:** secciones 2.3, 2.4, 3.9
- **Criterios de aceptación:**
  1. Dado un administrador, cuando crea una categoría o un tipo de experiencia y confirma, entonces queda disponible al registrar fichas y como filtro del visitante. (Confirmado, D-004)
  2. Las categorías y los tipos de experiencia son listas cerradas: al registrar una ficha solo se elige entre los que creó el administrador, sin escribir uno nuevo. (Confirmado, D-004)
  3. Dado un nombre ya existente, cuando se intenta crear otro igual, entonces el sistema lo rechaza. (Confirmado, sección 3.12)
  4. Dado un administrador, cuando edita una categoría o tipo y confirma, entonces el cambio se refleja en las fichas que la usan. (Inferido)
- **Estado:** Confirmado (criterio 4 Inferido)

### Registro de contenido

Campos obligatorios de toda ficha (Confirmado, D-003): nombre, municipio, categoría, descripción, horarios, contacto y enlace de Maps. Duplicado (Confirmado, D-003): mismo nombre en el mismo municipio. Los formularios largos de fichas están en la Mini App (Confirmado, D-002). Límites de caracteres (Confirmado, D-042): nombre 100, descripción 1500, horarios 300, contacto 200; los demás campos, Pendiente (arquitectura, Pendiente 6).

### HU-009: Registrar un atractivo turístico
- **Historia:** Como administrador, quiero registrar la ficha de un sitio natural, cultural, histórico o patrimonial, para que el visitante lo descubra.
- **Fuente:** secciones 3.2, 3.9
- **Criterios de aceptación:**
  1. Dado un administrador, cuando completa en la Mini App los campos obligatorios (nombre, municipio, categoría, descripción, horarios, contacto y enlace de Maps) y confirma, entonces el atractivo queda registrado. (Confirmado, D-002, D-003)
  2. Dado un formulario con campos obligatorios vacíos o inválidos, cuando se intenta guardar, entonces el sistema indica qué campo falla y no guarda. (Confirmado, sección 3.12)
  3. Dado un atractivo con el mismo nombre en el mismo municipio, cuando se intenta registrar, entonces el sistema lo rechaza como duplicado. (Confirmado, D-003)
  4. El atractivo registrado por el administrador queda publicado al confirmar, sin flujo de validación. (Confirmado, D-005)
- **Estado:** Confirmado

### HU-010: Registrar un establecimiento o alojamiento
- **Historia:** Como prestador autorizado, quiero registrar la ficha de mi establecimiento (hotel, finca cafetera, alojamiento rural u otro servicio), para que, una vez aprobada, la vean los visitantes.
- **Fuente:** secciones 2.3, 3.3
- **Criterios de aceptación:**
  1. Dado un prestador autorizado, cuando guarda en la Mini App una ficha nueva, entonces queda en estado borrador, asociada a su negocio, y no es visible al visitante. (Confirmado; canal, D-002)
  2. Dado una ficha en borrador, cuando el prestador la envía a revisión y confirma, entonces pasa a estado pendiente y deja de ser editable hasta que el administrador decida. (Confirmado: estado pendiente; bloqueo de edición Inferido)
  3. Dado un formulario con alguno de los campos obligatorios de D-003 vacío o inválido, cuando se intenta enviar a revisión, entonces el sistema indica qué falla y no la envía. (Confirmado, sección 3.12, D-003)
  4. Dado una ficha con el mismo nombre en el mismo municipio que otra, cuando se intenta registrar, entonces se rechaza como duplicado. (Confirmado, D-003)
  5. Un prestador puede tener varios negocios y registrar una ficha por cada uno. (Confirmado: varios negocios, D-006; una ficha por negocio, Inferido)
  6. Tipos de establecimiento: lista cerrada administrada por el administrador en la Mini App con hotel, finca cafetera, alojamiento rural, restaurante y café; dato opcional al enviar a revisión. (Confirmado, D-040, D-041)
  7. Dado una ficha que el prestador envía a revisión, cuando confirma el envío, entonces el sistema le pide declarar que tiene la autorización de los guías y contactos cuyos datos incluye, y sin esa declaración no la envía. Aplica también a las fichas de HU-011 y HU-012, que siguen el mismo flujo. (Confirmado, D-024)
- **Estado:** Confirmado (criterios 2 y 5 parcialmente Inferido)

### HU-011: Registrar un restaurante, café o experiencia gastronómica
- **Historia:** Como prestador autorizado, quiero registrar mi restaurante, café o experiencia gastronómica, para aparecer en el directorio gastronómico.
- **Fuente:** secciones 2.4, 3.3, 3.4
- **Criterios de aceptación:**
  1. Dado un prestador, cuando registra una ficha de tipo de establecimiento restaurante o café, entonces sigue el mismo flujo de estados y los mismos campos obligatorios que HU-010 (borrador, pendiente, publicada, rechazada). (Confirmado, D-003, D-004)
  2. Dado una ficha gastronómica publicada, cuando el visitante consulta el directorio gastronómico, entonces la ve. (Confirmado, sección 3.4)
- **Estado:** Confirmado

### HU-012: Registrar una ruta o experiencia
- **Historia:** Como prestador autorizado, quiero registrar un recorrido, actividad o experiencia con su tipo de experiencia, para que los visitantes la encuentren.
- **Fuente:** secciones 3.5, 3.9
- **Criterios de aceptación:**
  1. Dado un prestador, cuando registra una ruta o experiencia con su tipo de experiencia, elegido de la lista cerrada, entonces sigue el flujo de estados y los campos obligatorios de HU-010. (Confirmado: flujo, sección 3.3; lista cerrada, D-004; campos, D-003)
  2. Los datos de guías se registran como datos de la ficha, no como usuarios. (Confirmado, D-014)
- **Estado:** Confirmado

### HU-013: Registrar un evento (fuera de esta entrega, D-030)
- **Historia:** Como administrador, quiero registrar festividades, actividades culturales, ferias y eventos turísticos con su fecha, para que aparezcan en la agenda.
- **Fuente:** sección 3.6
- **Criterios de aceptación** (para una entrega posterior):
  1. Dado un administrador, cuando registra un evento con municipio, fecha y hora de inicio y fin y los demás campos obligatorios, y confirma, entonces queda en la agenda sin validación. (Confirmado: agenda, sección 3.6; registro por el administrador sin validación, D-005; campos propios del evento Pendiente)
  2. Dado una fecha de fin anterior a la de inicio, cuando se intenta guardar, entonces el sistema la rechaza. (Confirmado, sección 3.12)
  3. Las fechas se registran y muestran en hora de America/Bogota. (Inferido, convención del proyecto)
- **Estado:** Fuera de esta entrega (D-030); sin funcionalidad en `feature_list.json`

### Validación y versiones

### HU-014: Aprobar o rechazar una ficha
- **Historia:** Como administrador, quiero aprobar o rechazar las fichas pendientes de los prestadores, para que solo el contenido validado llegue al visitante.
- **Fuente:** sección 3.3
- **Criterios de aceptación:**
  1. Dado una ficha pendiente, cuando el administrador la aprueba en el bot y confirma, entonces pasa a publicada y aparece en las consultas del visitante. (Confirmado; canal, D-002)
  2. Dado una ficha pendiente, cuando el administrador la rechaza, entonces el sistema le exige escribir un motivo y, al confirmar, la ficha pasa a rechazada. (Confirmado)
  3. Dado un prestador, cuando intenta cambiar el estado de su ficha a publicada o rechazada (incluso enviando la petición directamente al backend), entonces el backend lo rechaza. (Confirmado)
  4. Cada aprobación o rechazo queda registrado con fecha, responsable y motivo. (Confirmado, sección 3.12)
  5. El prestador recibe un mensaje del bot con el resultado. (Inferido)
- **Estado:** Confirmado (criterio 5 Inferido)

### HU-015: Consultar estado y motivo de rechazo
- **Historia:** Como prestador, quiero ver el estado de mis fichas y el motivo de rechazo, para corregirlas.
- **Fuente:** sección 3.3
- **Criterios de aceptación:**
  1. Dado un prestador, cuando consulta sus fichas, entonces ve el estado de cada una (borrador, pendiente, publicada, rechazada). (Confirmado)
  2. Dado una ficha rechazada, cuando el prestador la abre, entonces ve el motivo escrito por el administrador. (Confirmado)
  3. Dado una ficha rechazada que nunca se publicó, cuando el prestador la corrige y la reenvía, entonces vuelve a pendiente. (Inferido)
- **Estado:** Confirmado (criterio 3 Inferido)

### HU-016: Editar una ficha publicada sin ocultarla
- **Historia:** Como prestador, quiero editar una ficha ya publicada sin que desaparezca mientras se revisa, para no perder visibilidad.
- **Fuente:** sección 3.3
- **Criterios de aceptación:**
  1. Dado una ficha publicada, cuando el prestador guarda cambios y los envía a revisión, entonces se crea una versión pendiente y el visitante sigue viendo la versión publicada anterior. (Confirmado)
  2. Dado una versión pendiente, cuando el administrador la aprueba, entonces el visitante pasa a ver la nueva versión. (Confirmado)
  3. Dado una versión pendiente, cuando el administrador la rechaza con motivo, entonces se descarta, se conserva la versión publicada y el prestador ve el motivo. (Confirmado)
  4. El administrador ve, al revisar, qué cambia entre la versión publicada y la pendiente. (Inferido)
  5. Despublicar o eliminar una ficha no está disponible en esta entrega. (Confirmado, D-014)
- **Estado:** Confirmado (criterio 4 Inferido)

### Galería y ubicación

### HU-017: Agregar fotografías a una ficha
- **Historia:** Como prestador o administrador, quiero agregar fotografías a una ficha, para que el visitante vea el lugar.
- **Fuente:** sección 3.7
- **Criterios de aceptación:**
  1. Dado una ficha propia, cuando el usuario sube una fotografía, entonces queda asociada a la ficha y se muestra al visitante solo cuando la versión que la contiene está publicada. (Confirmado: fotografías, sección 3.7; visibilidad según estado, sección 3.3)
  2. Dado un archivo que no es imagen, cuando se sube, entonces se rechaza con un mensaje claro. (Confirmado, sección 3.12)
  3. Dado una ficha que se enviará a aprobación con 10 fotografías, cuando se intenta agregar otra, entonces se rechaza con un mensaje claro. (Confirmado, D-031)
  4. Dado una ficha cuyas fotografías suman 2 GB, cuando se intenta agregar una que supera ese total, entonces se rechaza con un mensaje claro. (Confirmado, D-031; se verifica con la prueba de integración de límites, porque con 10 fotos de 5 MB una ficha llega como máximo a 50 MB)
  5. Los mismos límites aplican a las fichas de atractivos del administrador, que no pasan por aprobación. (Inferido)
  6. Dado una fotografía de más de 5 MB, o una que haría superar la cuota global de 900 MB del almacén de fotos, cuando se sube, entonces se rechaza con un mensaje claro. (Confirmado, D-042)
  7. Dado una foto de una ficha propia, cuando el usuario elige quitarla, entonces el sistema pide confirmación y, al confirmar, la foto deja de estar asociada a la ficha. (Confirmado: confirmación, sección 3.12)
- **Estado:** Confirmado (criterio 5 Inferido)

### HU-018: Indicar y abrir la ubicación
- **Historia:** Como prestador o administrador, quiero registrar la ubicación de una ficha con un enlace a Google Maps, para que el visitante sepa cómo llegar.
- **Fuente:** sección 3.7
- **Criterios de aceptación:**
  1. Dado una ficha, cuando se registra un enlace de ubicación de Google Maps válido, entonces queda guardado. El enlace es campo obligatorio. (Confirmado, sección 3.7, D-003)
  2. Dado un enlace que no es de Google Maps, cuando se intenta guardar, entonces se rechaza con un mensaje claro. (Inferido)
  3. Dado una ficha publicada con ubicación, cuando el visitante pulsa el botón de ubicación, entonces se abre el enlace de Google Maps. (Confirmado)
- **Estado:** Confirmado (criterio 2 Inferido)

### Consulta del visitante

### HU-019: Explorar por municipio y categoría en el bot
- **Historia:** Como visitante, quiero explorar la oferta por municipio y categoría con botones en el bot, para encontrar qué hacer sin registrarme.
- **Fuente:** secciones 2.3, 3.9, 3.10
- **Criterios de aceptación:**
  1. Dado un visitante sin registro, cuando elige explorar, entonces el bot muestra los municipios disponibles como botones. (Confirmado)
  2. Dado un municipio elegido, cuando el visitante elige una categoría, entonces el bot lista solo las fichas publicadas de ese municipio y categoría. (Confirmado)
  3. Dado un municipio y categoría sin fichas publicadas, cuando el visitante los elige, entonces el bot lo informa y ofrece volver. (Confirmado, sección 3.12)
  4. Ninguna ficha en borrador, pendiente o rechazada aparece en la lista. (Confirmado, sección 3.3)
- **Estado:** Confirmado

### HU-020: Ver la ficha de detalle en el bot
- **Historia:** Como visitante, quiero ver el detalle de una ficha, para conocer fotos, horarios, contacto y ubicación.
- **Fuente:** secciones 2.3, 3.7, 3.9
- **Criterios de aceptación:**
  1. Dado una ficha publicada, cuando el visitante la abre, entonces el bot muestra sus fotografías, horarios, datos de contacto y un botón de ubicación. (Confirmado)
  2. La ficha no muestra el número de identidad del prestador ni otros datos personales no destinados al público. (Confirmado, sección 3.15, D-011)
- **Estado:** Confirmado

### HU-021: Filtrar por tipo de experiencia
- **Historia:** Como visitante, quiero filtrar rutas y experiencias por tipo de experiencia, para encontrar las que me interesan.
- **Fuente:** secciones 3.5, 3.9
- **Criterios de aceptación:**
  1. Dado un visitante, cuando elige un tipo de experiencia, entonces el bot lista solo las rutas y experiencias publicadas de ese tipo, opcionalmente dentro del municipio elegido. (Confirmado: organización por tipo de experiencia; combinación con municipio Inferido)
- **Estado:** Confirmado

### HU-022: Consultar la agenda de eventos (fuera de esta entrega, D-030)
- **Historia:** Como visitante, quiero ver la agenda de eventos, para planear mi visita.
- **Fuente:** sección 3.6
- **Criterios de aceptación** (para una entrega posterior):
  1. Dado eventos registrados, cuando el visitante abre la agenda, entonces el bot muestra los eventos que no han terminado, ordenados por fecha de inicio, con fecha, hora y municipio. (Confirmado: agenda; regla de "no terminados" y orden Inferido)
  2. Dado un municipio elegido, cuando el visitante filtra la agenda, entonces ve solo los eventos de ese municipio. (Inferido)
- **Estado:** Fuera de esta entrega (D-030); sin funcionalidad en `feature_list.json`

### HU-023: Explorar el catálogo en la Mini App (fuera de esta entrega, D-030)
- **Historia:** Como visitante, quiero abrir desde el bot un catálogo visual con fotos, para comparar opciones con más comodidad.
- **Fuente:** sección 3.10; D-002
- **Criterios de aceptación** (para una entrega posterior):
  1. Dado un visitante en el bot, cuando pulsa el botón del catálogo, entonces se abre la Mini App dentro de Telegram con las fichas publicadas filtrables por municipio y categoría. (Confirmado: catálogo con fotos en la Mini App, D-002; filtros Inferido)
  2. Dado una ficha en la Mini App, cuando el visitante la abre, entonces ve fotografías, horarios, contacto y el enlace de ubicación. (Inferido)
- **Estado:** Fuera de esta entrega (D-030); sin funcionalidad en `feature_list.json`

### Solicitudes

### HU-024: Enviar una solicitud de información o interés
- **Historia:** Como visitante, quiero enviar una solicitud de información o de interés en una reserva desde una ficha, para que el prestador me contacte.
- **Fuente:** sección 3.8
- **Criterios de aceptación:**
  1. Dado una ficha publicada de un prestador, cuando el visitante elige "Solicitar información", entonces el bot le pide nombre, fecha de interés, número de personas y mensaje, en ese formulario conversacional. (Confirmado)
  2. Dado un visitante que no aceptó el aviso de privacidad, cuando envía /start o cualquier mensaje, entonces el bot le muestra el aviso antes de mostrar fichas o recolectar datos; sin aceptarlo no puede explorar ni enviar solicitudes. (Confirmado, sección 3.15, D-039)
  3. Dado una fecha pasada o inválida o un número de personas que no es un entero mayor que cero, cuando se envía, entonces el bot lo rechaza y vuelve a pedir el dato. (Confirmado: validación, sección 3.12; regla concreta Inferido)
  4. Dado el formulario completo, cuando el visitante confirma, entonces la solicitud queda en estado nueva, dirigida al negocio de la ficha, y el visitante recibe confirmación de envío que aclara que no es una reserva confirmada. (Confirmado: estado nueva, secciones 3.8 y 3.14; texto aclaratorio Inferido)
  5. El bot propone como nombre el de la cuenta de Telegram del visitante, y el visitante puede cambiarlo. (Confirmado, D-010)
  6. Las fichas de atractivos registrados por el administrador no ofrecen solicitud, porque no tienen prestador. (Inferido a partir de D-005)
  7. Las fichas publicadas de un prestador que revocó su autorización no ofrecen "Solicitar información". (Confirmado, D-029)
- **Estado:** Confirmado (criterio 3 y 4 parcialmente Inferido; criterio 6 Inferido)

### HU-025: Recibir la alerta de una solicitud
- **Historia:** Como prestador, quiero recibir una alerta en Telegram al llegar una solicitud, para atenderla a tiempo.
- **Fuente:** sección 3.8
- **Criterios de aceptación:**
  1. Dado una solicitud nueva, cuando se registra, entonces el prestador del negocio recibe un mensaje del bot con los datos de la solicitud y un botón para atenderla. (Confirmado: alerta; botón Inferido)
  2. Ningún otro prestador recibe la alerta. (Confirmado, sección 3.12, D-011)
- **Estado:** Confirmado

### HU-026: Responder y gestionar el estado de una solicitud
- **Historia:** Como prestador, quiero responder la solicitud y marcarla como atendida o cerrada, para llevar control de lo que atiendo.
- **Fuente:** sección 3.8
- **Criterios de aceptación:**
  1. Dado una solicitud nueva, cuando el prestador escribe una respuesta en texto libre y confirma, entonces el visitante la recibe por el bot. (Confirmado, D-010)
  2. Dado una solicitud, cuando el prestador la marca atendida y luego cerrada, confirmando cada cambio, entonces el estado cambia en ese orden y queda registrado con fecha y responsable. (Confirmado: estados y que solo el prestador los cambia; registro, sección 3.12)
  3. Dado un visitante o un administrador, cuando intenta cambiar el estado de una solicitud, entonces el backend lo rechaza. (Confirmado)
  4. Dado un administrador u otro prestador, cuando pide los datos de una solicitud, entonces el backend los niega: solo los ve el prestador del negocio. (Confirmado, D-011)
  5. Dado una solicitud cerrada, cuando el prestador intenta volver a nueva, entonces el sistema lo impide. (Inferido)
  6. Dado un prestador, cuando consulta sus solicitudes, entonces las ve filtrables por estado, solo las de su negocio. (Confirmado: separación, sección 3.12; filtro Inferido)
- **Estado:** Confirmado (criterios 5 y 6 parcialmente Inferido)

### Transversales

### HU-027: Cancelar formularios y corregir entradas inválidas
- **Historia:** Como usuario del bot, quiero cancelar un formulario en cualquier paso y recibir mensajes claros ante errores, para no quedar atrapado ni guardar datos a medias.
- **Fuente:** sección 3.12
- **Criterios de aceptación:**
  1. Dado un formulario conversacional en curso, cuando el usuario elige cancelar, entonces el bot confirma la cancelación, no guarda nada del formulario y vuelve al menú. (Confirmado)
  2. Dado una entrada inválida en un paso, cuando se envía, entonces el bot explica el error y repite solo ese paso. (Confirmado)
  3. Dado un error del sistema, cuando ocurre, entonces el bot muestra un mensaje claro sin detalles técnicos ni datos personales. (Confirmado; detalle Inferido)
- **Estado:** Confirmado

### HU-028: Consultar la trazabilidad de una ficha
- **Historia:** Como administrador, quiero ver el historial de estados de una ficha con fechas y responsables, para auditar la publicación.
- **Fuente:** sección 3.12
- **Criterios de aceptación:**
  1. Dado una ficha, cuando el administrador consulta su historial, entonces ve cada cambio de estado con fecha y hora (America/Bogota), responsable y motivo cuando hubo rechazo. (Confirmado: registro; consulta por el administrador Inferido)
- **Estado:** Inferido

### HU-029: Reportes básicos (fuera de esta entrega, D-030)
- **Historia:** Como administrador, quiero consultar reportes básicos de la operación, para apoyar decisiones.
- **Fuente:** sección 3.12; D-009
- **Criterios de aceptación** (para una entrega posterior): los reportes son fichas por estado y municipio, y solicitudes por estado (Confirmado, D-009). Los criterios detallados se escriben cuando la historia vuelva al alcance.
- **Estado:** Fuera de esta entrega (D-030); no se crea su funcionalidad

### HU-030: Revocar mi autorización
- **Historia:** Como usuario de Telegram (visitante, prestador o administrador), quiero revocar la autorización que di para el tratamiento de mis datos desde el inicio del bot o de la Mini App, para retirar mi consentimiento y que se eliminen mis datos.
- **Fuente:** sección 3.15; D-018, D-019, D-020, D-021, D-023, D-029, D-032
- **Criterios de aceptación:**
  1. Dado un usuario que aceptó el aviso, cuando abre el inicio del bot o la pantalla inicial de la Mini App, entonces ve la opción "Revocar mi autorización" y, junto a ella, la frase "El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador". (Confirmado, D-018, D-023)
  2. Dado que el usuario elige la opción, cuando el sistema pide confirmación y el usuario cancela, entonces no cambia nada. (Confirmado, sección 3.12)
  3. Dado que el usuario confirma, entonces se borra de inmediato la vinculación de su chat de Telegram y solo se conserva, sin número de identidad, la prueba de que autorizó y revocó (fecha y hora en America/Bogota, canal y versión del aviso). (Confirmado: borrador del aviso, D-008; plazo, D-021)
  4. Dado un usuario que revocó, cuando vuelve a abrir el bot o la Mini App, entonces se le muestra de nuevo el aviso y debe aceptarlo para seguir; no se pide ni se envía ningún código. (Confirmado, D-018)
  5. Dado un visitante que revoca, entonces conserva el uso del bot como visitante tras aceptar de nuevo el aviso, sus solicitudes se borran de inmediato y el prestador de cada una recibe un aviso de que ya no está disponible. (Confirmado, D-019)
  6. Dado un prestador que revoca, entonces se borran su número de identidad y su registro, pierde el rol de prestador y sus fichas publicadas siguen visibles hasta el 31 de enero de 2027, pero dejan de ofrecer "Solicitar información". (Confirmado, D-019, D-021, D-029; despublicar está fuera de alcance, D-014)
  7. Dado un prestador que revoca, entonces sus fichas no publicadas (borrador, pendiente, rechazada) quedan en el estado en que estaban y no son visibles al visitante. (Confirmado, D-029)
  8. Dado un prestador que revoca, entonces las solicitudes que recibieron sus negocios se borran y cada visitante que las envió recibe un aviso por el bot. (Confirmado, D-029; texto del aviso Inferido)
  9. Dado un administrador que revoca, entonces pierde el rol de administrador. Si es el administrador principal o el único administrador, el sistema no le permite revocar y le explica el motivo, nombrándolo "administrador principal" cuando corresponde. (Confirmado, D-020, D-032)
- **Estado:** Confirmado (texto del aviso al visitante del criterio 8 Inferido)

## Requisitos no funcionales
| ID | Requisito | Cómo se verifica | Fuente |
| --- | --- | --- | --- |
| RNF-001 | Cada operación verifica en el backend el usuario, su rol, el negocio al que pertenece y los permisos; nunca se confía solo en el bot ni en la Mini App (invariante 1) | Peticiones directas al backend sin rol o con otro rol son rechazadas (F007, F008) | Secciones 3.11, 3.16 |
| RNF-002 | La información de cada negocio está separada; un prestador solo ve y edita lo suyo, incluidas sus solicitudes (invariante 2) | Prestador A intenta leer o editar fichas y solicitudes del prestador B y es rechazado (F016, F033) | Secciones 3.11, 3.12 |
| RNF-003 | Solo el administrador aprueba o rechaza; el visitante solo ve fichas publicadas; al editar una ficha publicada la versión anterior sigue visible hasta aprobar la nueva (invariante 3) | F014, F015 y verificación de que ninguna consulta del visitante devuelve borradores, pendientes ni rechazadas | Sección 3.3 |
| RNF-004 | El rol de administrador o prestador existe solo si el administrador autorizó el ID de Telegram (invariante 4); la única excepción es el administrador principal, fijado en la configuración de la publicación | Un ID no autorizado no accede a funciones de rol, aunque haya completado el registro (F002, F007); el administrador principal accede sin autorización previa (F004) | Secciones 2.3, 3.16; D-007, D-032 |
| RNF-005 | Sin motor de reservas, pagos ni administración hotelera; las solicitudes se remiten al prestador, único que cambia su estado (invariante 5) | No existe ninguna opción de pago, cupo o confirmación automática; F032 y F033 | Secciones 3.8, 3.14 |
| RNF-006 | La solución funciona sola; ninguna integración con otros aplicativos es requisito (invariante 6). El enlace a Google Maps es un enlace, no una integración obligatoria | Demostración completa con solo los componentes del proyecto | Sección 3.11 |
| RNF-007 | Los datos personales se tratan conforme a la Ley 1581 de 2012, con aviso de privacidad aceptado antes de recolectarlos; sin aceptación no se guarda ningún dato (invariante 7) | F001, F036; intentar registrar o enviar solicitud sin aceptar el aviso no recolecta datos | Sección 3.15; D-008 |
| RNF-008 | El número de identidad del prestador nunca se muestra al visitante ni a otros prestadores, ni aparece en registros técnicos (logs) ni en mensajes de error | F027; revisión de los registros técnicos durante QA | Sección 3.15; D-011; guía de agentes (architect) |
| RNF-009 | El número de identidad solo lo ven administradores; los datos de una solicitud solo los ve el prestador del negocio | Pruebas de acceso con otros roles (F027, F033) | Secciones 3.12, 3.16; D-011 |
| RNF-010 | Las operaciones importantes (enviar a revisión, aprobar, rechazar, autorizar, revocar, editar, enviar solicitud, cambiar estado) piden confirmación antes de ejecutarse (invariante 8) | Cada funcionalidad incluye el paso de confirmación; cancelar en la confirmación no ejecuta nada | Sección 3.12 |
| RNF-011 | Validación de datos y prevención de registros duplicados o inconsistentes; duplicado de ficha = mismo nombre en el mismo municipio | Pruebas de duplicado y de datos inválidos en F002, F010, F011, F012, F013 | Sección 3.12; D-003 |
| RNF-012 | Trazabilidad: fechas, estados y responsables de cada cambio relevante | F029 y registros de F003, F014, F032 | Sección 3.12 |
| RNF-013 | Mensajes claros, manejo de errores, cancelaciones y situaciones excepcionales en bot y Mini App | F028 (bot) y F013, últimos dos pasos (Mini App, pantalla M12) | Sección 3.12 |
| RNF-014 | En la Mini App, el backend valida la firma de los datos de inicio de Telegram en cada petición y rechaza las que no la tienen o la tienen alterada | F009 | Sección 3.16 (Inferido) |
| RNF-015 | Credenciales (token del bot, claves de base de datos y de almacenamiento de fotos) solo en variables de entorno; nunca en el repositorio | Revisión del repositorio: no hay credenciales; existe la plantilla de variables sin valores | CLAUDE.md, sección Seguridad; sección 3.17 |
| RNF-016 | Fechas y horas se registran y muestran en la zona horaria America/Bogota | Las fechas de aceptación, revocación y cambios de estado se muestran en hora de Colombia | CLAUDE.md, Convenciones (Inferido en la guía de agentes) |
| RNF-017 | Textos visibles para el usuario en español; el administrador fijado en la configuración se nombra "administrador principal" | Recorrido de QA por bot y Mini App | Sección 1, regla 1; D-032 |
| RNF-018 | Telegram es el canal principal; no hay interfaz web como canal principal | La Mini App solo se abre desde Telegram | Sección 3.10; guía de agentes |
| RNF-019 | Rendimiento y accesibilidad: el contexto no fija cifras de tiempo de respuesta ni nivel de accesibilidad | No verificable hasta definir cifras | Pendiente (no hay sección que lo defina) |
| RNF-020 | Trazabilidad de especificaciones: cada funcionalidad remite a historias y cada historia a una sección del contexto | Tabla de trazabilidad de este documento | Sección 3.13 |
| RNF-021 | Los datos personales se conservan hasta el 31 de enero de 2027 y ese día se eliminan, una sola vez: cuentas, permisos, consentimientos (incluida la prueba de autorización y revocación), registros, solicitudes, auditoría y fichas de prestadores con sus fotos; se conservan municipios, listas cerradas, atractivos y el aviso | F038; procedimiento descrito en la ADR 0007 | Sección 3.15; D-021, D-043 |
| RNF-022 | Las consultas y correcciones de datos personales se atienden solo por correo electrónico y teléfono; el bot y la Mini App no ofrecen esa opción | Recorrido de QA por los menús del bot y de la Mini App: no existe opción para consultar o corregir datos personales | Sección 3.15; D-025 |
| RNF-023 | El aviso de privacidad menciona la transferencia internacional de datos: base de datos, funciones y fotos en São Paulo (Brasil); la CDN de Vercel puede guardar copias en caché en otros países | Revisión del apartado 5 de `docs/05-aviso-privacidad.md` | Sección 3.15; D-022, D-034, D-035 (resuelto) |
| RNF-024 | Las fotografías respetan estos límites: 10 por ficha enviada a aprobación, 2 GB en total por ficha, 5 MB por foto y cuota global de 900 MB | F020; el tope de 2 GB por ficha se verifica con la prueba de integración de límites | Sección 3.7; D-031, D-042 (resuelto) |

## Trazabilidad
| Historia | Funcionalidades |
| --- | --- |
| HU-001 | F001, F036 |
| HU-002 | F002, F027 |
| HU-003 | F003, F007 |
| HU-004 | F004, F008 |
| HU-005 | F006 |
| HU-006 | F005, F007, F009 |
| HU-007 | F010 |
| HU-008 | F011 |
| HU-009 | F012 |
| HU-010 | F013, F016 |
| HU-011 | F017 |
| HU-012 | F018 |
| HU-013 | Ninguna (fuera de esta entrega, D-030; se retiró F019) |
| HU-014 | F014, F008 |
| HU-015 | F014 |
| HU-016 | F015 |
| HU-017 | F020 |
| HU-018 | F021 |
| HU-019 | F022 |
| HU-020 | F023, F027 |
| HU-021 | F024 |
| HU-022 | Ninguna (fuera de esta entrega, D-030; se retiró F025) |
| HU-023 | Ninguna (fuera de esta entrega, D-030; se retiró F026) |
| HU-024 | F030, F037 |
| HU-025 | F031 |
| HU-026 | F032, F033 |
| HU-027 | F028 |
| HU-028 | F029 |
| HU-029 | Ninguna (fuera de esta entrega, D-030) |
| HU-030 | F034, F035, F036, F037, F038 |

## Pendientes
- Formato válido del número de identidad (HU-002, criterio 4): Pendiente (D-045). Bloquea el cierre de F002.
- Texto del aviso al visitante cuando se borra su solicitud porque el prestador revocó (apartado 2.5 del aviso): sin redactar.
- Si las experiencias gastronómicas que nombra la sección 3.4 entran al directorio gastronómico (HU-011, F017): D-040 dice que el directorio son restaurante y café. Pendiente; la usuaria decide.
- Contradicción entre D-044 (aprueba la regla Inferida "un administrador también puede registrarse como prestador") y D-038 (no puede): se aplica D-038 (HU-006, criterio 3). Pregunta para la usuaria en el brief.
- "Revocar rol" sobre el administrador principal (HU-005, criterio 6): Inferido, pregunta 21 sin respuesta tras la ronda 3.
- Límites de caracteres de los campos que no cubre D-042 (arquitectura, Pendiente 6).
- Cifras de rendimiento y nivel de accesibilidad (RNF-019).

Resueltos tras el informe de preparación y retirados de esta lista: texto del aviso (D-034), región de los servidores (D-034, D-035), viabilidad y límites de fotos y límites de caracteres de la ficha (D-042), lista de tipos de establecimiento y quién la administra (D-040, D-041), efectos de "Revocar rol" sobre un prestador y procedimiento de eliminación del 31 de enero de 2027 (D-043; ADR 0007, F038).
