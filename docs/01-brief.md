# Brief: Eje Turismo

Fuente: `docs/00-contexto-producto.md` (versión 1, estado Borrador). Reglas del proyecto: `docs/guia-agentes.md` (sección product-manager). Registro de decisiones congeladas: D-001 a D-045 (rondas 1 a 3 de la fase 1 y ronda 1 de la fase 3).

Marcas: **Confirmado** sale del contexto o de una decisión congelada; **Inferido** es una deducción que la usuaria debe aprobar; **Pendiente** falta información.

Actualización 2026-11-14 (ronda 3): se aplican D-029 a D-032 (efectos de la revocación del prestador, recortes de D-012, límite de fotos y nombre "administrador principal"), se registra D-033 como Pendiente y se anotan las tareas del architect (D-022 y D-031). Se revisó también la aplicación de D-002 a D-016 en requisitos y funcionalidades.

Actualización 2026-11-14 (tras el informe de preparación): se aplican D-034 a D-045 y se agrega F038 (eliminación de datos del 31 de enero de 2027). Quedan Pendiente el formato del número de identidad (D-045), el texto del aviso al visitante del apartado 2.5 y las experiencias gastronómicas en el directorio; se registra la contradicción entre D-038 y D-044.

## Problema
La información turística de Manizales y los municipios del Eje Cafetero está dispersa en redes sociales, páginas y contactos individuales; el visitante necesita información organizada y confiable sobre lugares, actividades, servicios, ubicación y formas de contacto (sección 2.2). Eje Turismo la reúne y la ofrece por un bot de Telegram, con una Telegram Mini App como interfaz visual complementaria (secciones 2.1 y 3.10).

## Actores
| Actor | Canal | Qué necesita del sistema | Fuente |
| --- | --- | --- | --- |
| Administrador de la plataforma | Bot de Telegram (aprobaciones, autorizaciones) y Mini App (formularios largos de fichas) (Confirmado, D-002) | Gestionar municipios, categorías, contenidos y usuarios autorizados; registrar atractivos sin validación; aprobar o rechazar lo que registra el prestador; autorizar IDs de Telegram y revocar roles. El administrador fijado en la configuración se llama "administrador principal" en los textos al usuario | Secciones 2.3, 3.3, 3.16; D-005, D-007, D-015, D-020, D-032 |
| Prestador u operador turístico | Bot de Telegram (registro, solicitudes) y Mini App (formularios largos de fichas) (Confirmado, D-002) | Registrarse una vez con su número de identidad, registrar y actualizar la información de sus negocios (puede tener varios) sujeta a validación, y atender solicitudes | Secciones 2.3, 3.3, 3.8; D-006 |
| Visitante o turista | Bot de Telegram (exploración, solicitudes) (Confirmado, D-002). El catálogo con fotos de la Mini App queda fuera de esta entrega (D-030); en la Mini App solo ve el aviso y la opción de revocar (D-025, D-018) | Explorar por municipio, categoría y tipo de experiencia; ver fotografías, ubicación, horarios y contacto; enviar solicitudes de información o interés. No necesita registro | Secciones 2.3, 3.7, 3.8, 3.9 |

## Objetivos
El contexto no da cifras ni métricas; ningún objetivo lleva cifra.

| Objetivo | Cómo se comprueba | Estado |
| --- | --- | --- |
| El visitante encuentra oferta turística organizada por municipio, categoría y tipo de experiencia desde Telegram (sección 3.9) | En la demostración, un visitante sin registro llega desde el bot a una ficha publicada con fotos, horarios, contacto y enlace de ubicación | Confirmado (sin cifra) |
| Solo se muestra al visitante contenido validado por el administrador (sección 3.3) | Una ficha en borrador, pendiente o rechazada no aparece en ninguna consulta del visitante | Confirmado |
| El prestador mantiene la información de su negocio sin acceder a la de otros (secciones 3.11, 3.12) | Las pruebas de acceso cruzado entre prestadores son rechazadas por el backend | Confirmado |
| El prestador recibe y atiende solicitudes de información o interés (sección 3.8) | Una solicitud genera alerta en Telegram y recorre los estados nueva, atendida y cerrada | Confirmado |
| Los datos personales se tratan conforme a la Ley 1581 de 2012 (sección 3.15) | El aviso de privacidad se acepta antes de recolectar datos; el número de identidad no es visible al visitante; la persona puede revocar su autorización desde el bot y la Mini App (D-018) | Confirmado (texto del aviso aprobado, D-034; aviso al visitante del apartado 2.5 Pendiente) |
| Trazabilidad entre especificación, implementación y aceptación (sección 3.13) | Cada funcionalidad de `feature_list.json` remite a historias y cada historia a una sección del contexto | Confirmado |
| Entrega el 26 de noviembre de 2026 (D-026) | Las funcionalidades de `feature_list.json` tienen `passes: true` en esa fecha | Confirmado (fecha); ver "Fecha de entrega y capacidad" |
| Métricas de uso o de éxito (visitas, tiempos, cantidad de fichas) | No definidas | Pendiente |

## Alcance
- Aviso de privacidad y tratamiento de datos aceptado al inicio del uso, en el bot y en la Mini App, antes de cualquier uso, incluida la exploración de fichas, con nueva aceptación al cambiar de versión; si no se acepta no se guarda ningún dato, salvo el ID de Telegram de un administrador ya autorizado, que el aviso menciona (sección 3.15; D-008, D-025, D-034, D-037, D-039).
- Eliminación de datos el 31 de enero de 2027, una sola vez, con el alcance de D-043 (sección 3.15; D-021, D-043; F038).
- Revocación de la autorización por la propia persona ("Revocar mi autorización") en el inicio del bot y de la Mini App, con los efectos de D-019 a D-021 y D-029 (sección 3.15; D-018, D-023).
- Registro inicial del prestador con número de identidad vinculado a su ID de Telegram, a la espera de autorización (sección 2.3). El administrador no se registra con número de identidad (D-007).
- Autorización por el administrador del ID de Telegram de administradores y prestadores, y revocación con la opción "Revocar rol"; el administrador principal se fija por su ID de Telegram en la configuración de la publicación. "Revocar rol" a un prestador solo le quita el rol y sus fichas publicadas dejan de aceptar solicitudes nuevas. Una cuenta con rol de administrador no puede registrarse también como prestador (secciones 2.3, 3.16; D-007, D-015, D-020, D-032, D-038, D-043).
- Ingreso posterior del usuario autorizado sin repetir el registro (sección 2.3).
- Gestión de municipios, categorías, tipos de experiencia y tipos de establecimiento por el administrador en la Mini App; las tres últimas son listas cerradas (secciones 2.3, 3.1, 3.9; D-004, D-040, D-041). Municipios iniciales: Manizales, Supía y Filadelfia, departamento de Caldas; zona es dato opcional (D-013, D-027).
- Fichas de atractivos turísticos, registradas por el administrador y publicadas sin validación (sección 3.2; D-005).
- Fichas de establecimientos y alojamientos (sección 3.3). Un prestador puede tener varios negocios (D-006). Tipos de establecimiento: hotel, finca cafetera, alojamiento rural, restaurante y café; dato opcional al enviar a revisión (D-040).
- Directorio gastronómico: restaurante y café (sección 3.4; D-004, D-040). Si las experiencias gastronómicas que nombra la sección 3.4 entran al directorio: Pendiente (ver "Preguntas abiertas").
- Rutas, recorridos, actividades y experiencias; los guías son datos de la ficha, no usuarios (sección 3.5; D-014).
- Campos obligatorios de toda ficha: nombre, municipio, categoría, descripción, horarios, contacto y enlace de Maps; duplicado = mismo nombre en el mismo municipio (D-003). Límites de caracteres: nombre 100, descripción 1500, horarios 300, contacto 200 (D-042).
- Validación del contenido del prestador: borrador, pendiente, publicada, rechazada, con motivo de rechazo y versión pendiente sobre versión publicada; al enviar a revisión el prestador declara tener la autorización de guías y contactos (sección 3.3; D-024).
- Fotografías y ubicación mediante enlace a Google Maps (sección 3.7). Límite de fotos: 10 por ficha enviada a aprobación y 2 GB en total por ficha (D-031); 5 MB por foto y cuota global de 900 MB (D-042).
- Consulta del visitante por el bot de Telegram (secciones 3.9, 3.10; D-002, D-016).
- Solicitudes de información o interés: formulario con nombre (tomado de Telegram y editable), fecha de interés, número de personas y mensaje; alerta al prestador; estados nueva, atendida, cerrada; respuesta en texto libre al visitante por el bot (sección 3.8; D-010). Los datos de una solicitud solo los ve el prestador del negocio; el número de identidad solo lo ven administradores (D-011).
- Controles transversales: autorización en el backend, separación por negocio, prevención de duplicados, trazabilidad de fechas, estados y responsables, confirmaciones, manejo de errores y cancelaciones (secciones 3.11, 3.12, 3.16).

## Fuera de alcance
Todo lo que el contexto declara fuera de alcance (sección 3.14):
- Motor de reservas: una solicitud de interés en una reserva no reserva, no bloquea cupos ni confirma nada por sí misma; solo se remite al prestador (secciones 3.8, 3.14).
- Pagos.
- Administración hotelera.
- Integraciones obligatorias con otros aplicativos: la solución funciona sola (sección 3.11).
- Interfaz web como canal principal (guía de agentes, product-manager).

Fuera de esta entrega por decisión de la usuaria:
- Despublicar o eliminar fichas, notificaciones de eventos a visitantes y guías como usuarios del sistema (D-014).
- Opción en el bot o la Mini App para consultar o corregir datos personales; se atiende solo por correo y teléfono (D-025).
- Recortes de D-012 aplicados por D-030:
  - Catálogo de la Mini App para el visitante (HU-023; se retira F026).
  - Agenda de eventos: registro de eventos por el administrador y consulta de la agenda por el visitante (HU-013 y HU-022; se retiran F019 y F025).
  - Reportes básicos (HU-029; no se crea su funcionalidad). La definición de D-009 queda registrada para una entrega posterior.

## Supuestos y riesgos
| Supuesto o riesgo | Impacto | Mitigación | Estado |
| --- | --- | --- | --- |
| El bot lleva privacidad, registro, exploración, solicitudes y aprobaciones; la Mini App lleva los formularios largos de fichas (sección 3.10) | Define el canal de cada funcionalidad | — | Confirmado (D-002; catálogo del visitante recortado por D-030) |
| El contenido que registra el administrador (atractivos) se publica sin validación (sección 3.3) | Define F012 | — | Confirmado (D-005) |
| Restaurantes y cafés son tipos de establecimiento y siguen el mismo flujo de validación (sección 2.4) | Define campos y filtros | — | Confirmado (D-004, D-040) |
| Las experiencias gastronómicas que nombra la sección 3.4 entran al directorio gastronómico | F017: D-040 dice que el directorio son restaurante y café | Mientras la usuaria no decida, el directorio muestra solo restaurante y café (valor por defecto de la arquitectura, Pendiente 4) | Pendiente |
| Un prestador puede tener varios negocios; "negocio" es la unidad de separación (sección 2.4) | Afecta la separación de datos y las solicitudes | Cómo se asocia cada ficha a uno de sus negocios lo concreta el architect sin contradecir D-006 | Confirmado (D-006); asociación ficha-negocio Pendiente |
| Una ficha rechazada que nunca se publicó puede corregirse y reenviarse a revisión (sección 3.3) | Define transiciones de estado | Aprobación de la usuaria al revisar requisitos | Inferido |
| Campos obligatorios comunes: nombre, municipio, categoría, descripción, horarios, contacto y enlace de Maps; duplicado = mismo nombre en el mismo municipio | Hace verificables los criterios de ficha completa | — | Confirmado (D-003) |
| Límite de fotos: 10 por ficha enviada a aprobación, 2 GB en total por ficha, 5 MB por foto y cuota global de 900 MB | F020 bloquea F023, y F023 bloquea las solicitudes (F030 a F033, F037) | Con 10 fotos de 5 MB una ficha llega como máximo a 50 MB; el tope de 2 GB se verifica con la prueba de integración de límites | Confirmado (D-031, D-042) |
| Si el mismo límite de fotos aplica a los atractivos del administrador, que no pasan por aprobación | Define un paso de F020 | Se aplica el mismo límite hasta que la usuaria diga otra cosa | Inferido |
| Formato válido del número de identidad (HU-002, criterio 4) | Bloquea el cierre en QA de F002 y, por dependencia, de F003, F005 y casi todo el recorrido | Mientras tanto, el código solo exige texto no vacío (arquitectura, Pendiente 1) | Pendiente (D-045) |
| Texto del aviso de privacidad (`docs/05-aviso-privacidad.md`) | F001, F034, F036 | Aprobado (D-034); falta redactar el aviso al visitante del apartado 2.5, que usa F037 | Confirmado; apartado 2.5 Pendiente |
| "Revocar rol" a un prestador solo le quita el rol y sus fichas publicadas dejan de aceptar solicitudes nuevas | F006 | F006 todavía describe este punto como Pendiente; el orquestador decide si se actualiza | Confirmado (D-043) |
| Una cuenta con rol de administrador no puede registrarse también como prestador | F002, F005 | Se aplica D-038; D-044 aprobó en bloque una regla Inferida contraria (ver "Preguntas abiertas") | Confirmado (D-038); contradicción con D-044 Pendiente |
| "Revocar rol" sobre el administrador principal: el sistema lo impide (pregunta 21, sin respuesta en la ronda 3) | Un paso de F006 | Se mantiene como Inferido | Inferido |
| Convertir las solicitudes en un motor de reservas | Contradice la sección 3.14 | Las solicitudes solo se remiten al prestador; sin cupos ni confirmación automática | Confirmado (riesgo) |
| Confiar en el bot o en la Mini App para el control de rol | Rompe las secciones 3.11 y 3.16 | Funcionalidades de seguridad verificadas contra el backend; validación de los datos de inicio de la Mini App (sección 3.16, Inferido) | Confirmado (riesgo) |
| Alcance mayor que la capacidad hasta el 26 de noviembre de 2026 (sección 3.13; D-026) | Puede impedir terminar a tiempo | Recortes de D-030 aplicados; ver "Fecha de entrega y capacidad" | Confirmado (riesgo) |

## Tareas del architect y pendientes de la usuaria
| Id | Qué falta | A quién corresponde | Bloquea | Estado |
| --- | --- | --- | --- | --- |
| D-045 | Formato del número de identidad | Usuaria | F002 (y su cadena de dependencias) | Pendiente |
| — | Texto del aviso al visitante cuando se borra su solicitud porque el prestador revocó (apartado 2.5 del aviso) | Usuaria | Cierre de F037 en el texto del mensaje | Pendiente |
| — | Si las experiencias gastronómicas de la sección 3.4 entran al directorio gastronómico (D-040 solo nombra restaurante y café) | Usuaria | F017 | Pendiente |
| — | Contradicción entre D-038 y D-044 sobre el administrador que se registra como prestador | Usuaria | F002, F005 | Pendiente |
| — | Límites de caracteres de los campos que no cubre D-042 (arquitectura, Pendiente 6) | Usuaria | Validaciones de longitud de esos campos | Pendiente |

Resueltas y retiradas de esta tabla: región de los servidores y transferencia internacional (D-022, D-034, D-035), viabilidad y límites de fotos (D-031, D-042), texto del aviso (D-034), límites de caracteres de la ficha (D-042), lista de tipos de establecimiento y quién la administra (D-040, D-041), efectos de "Revocar rol" sobre un prestador y alcance de la eliminación (D-043).

Nota para el orquestador (m-01 del informe de preparación): la nota anterior quedó superada. `docs/05-aviso-privacidad.md` ya no pone los reportes como finalidad, recoge D-029 y D-032 y, tras esta actualización, también D-034 (transferencia internacional), D-037 (ID del administrador antes de aceptar) y D-039 (sin aceptar no se usa el bot ni la Mini App). Quedan por actualizar, fuera de lo que pidió esta orden, las descripciones de F001 y F002, que todavía citan D-033, y la de F006, que todavía marca como Pendiente lo que resolvió D-043.

## Fecha de entrega y capacidad
- **Fecha:** 26 de noviembre de 2026 (D-026). Desde hoy, 2026-11-14, quedan 12 días calendario. [Confirmado]
- **Alcance actual:** 35 funcionalidades en `feature_list.json` (33 aprobadas en D-001, más 4 de privacidad de D-018 a D-020 (F034 a F037), menos F019, F025 y F026, retiradas por D-030, más F038, eliminación de datos de D-043). [Confirmado]
- **Evaluación (Inferido):** el contexto no da una velocidad de trabajo, así que no hay cifra de capacidad. 35 ciclos de contrato, código y QA en 12 días, después de la arquitectura, siguen siendo un riesgo alto. Además, D-045 deja sin resolver el formato del número de identidad (F002), que está al inicio de la ruta principal.

## Preguntas abiertas
Cada pregunta lleva la opción recomendada por el product-manager; la usuaria decide.

### Resueltas
| # | Pregunta | Resolución |
| --- | --- | --- |
| 1 | Reparto de flujos entre Mini App y bot | D-002 (catálogo del visitante recortado por D-030) |
| 2 | Campos obligatorios de ficha y regla de duplicado | D-003 |
| 3 | Categorías y tipos de experiencia; tipos de establecimiento | D-004, D-040 y D-041 (experiencias gastronómicas en el directorio, Pendiente) |
| 4 | Quién registra atractivos y eventos, y si se validan | D-005 (eventos fuera de esta entrega, D-030) |
| 5 | Varios negocios por prestador | D-006 |
| 6 | Registro con número de identidad para administradores | D-007 (no) |
| 7 | Primer administrador | D-007 (fijado por su ID de Telegram en la configuración) y D-032 ("administrador principal") |
| 8 | Aviso de privacidad y qué pasa si no se acepta | D-008, D-018 a D-025, D-034, D-036, D-037 y D-039 (aviso al visitante del apartado 2.5, Pendiente) |
| 9 | Reportes básicos | D-009 (fuera de esta entrega, D-030) |
| 10 | Nombre de la solicitud y respuesta del prestador | D-010 |
| 11 | Quién ve el número de identidad y los datos de solicitudes | D-011 |
| 12 | Fecha de entrega y módulos recortables | D-012, D-026 y D-030 |
| 13 | Límites de fotos | D-028 aclarado por D-031 y D-042 (5 MB por foto, cuota de 900 MB y caracteres de la ficha) |
| 14 | Municipios iniciales y "zona" | D-013 y D-027 |
| 15 | Despublicar o eliminar fichas | D-014 (fuera de esta entrega) |
| 16 | Revocar autorizaciones por el administrador | D-015 y D-020 (opción "Revocar rol") |
| 17 | Notificaciones de eventos | D-014 (fuera de esta entrega) |
| 18 | Guías como usuarios | D-014 (solo datos de la ficha) |
| 19 | Orden de prioridades | D-016 y D-017 |
| 20 | Efectos de la revocación del prestador sobre fichas no publicadas y solicitudes | D-029; "Revocar rol" sobre un prestador, D-043 |
| 22 | Aplicar los recortes de D-012 | D-030 |
| — | Región de los servidores y transferencia internacional | D-034 y D-035 |
| — | Eliminación del 31 de enero de 2027 | D-043 (F038) |

### Sin respuesta tras la ronda 3
Las dudas se resuelven en máximo 3 rondas; estas quedan como Pendiente o Inferido, sin pregunta nueva.

| # | Tema | Estado |
| --- | --- | --- |
| 21 | "Revocar rol" sobre el administrador principal: el sistema lo impide | Inferido (F006) |
| D-045 | Formato del número de identidad | Pendiente |

### Pendientes tras el informe de preparación
| # | Pregunta | Opción recomendada | Estado |
| --- | --- | --- | --- |
| 23 | D-044 aprobó en bloque las reglas Inferidas del antiguo Pendiente 22 de la arquitectura, que incluían "un administrador también puede registrarse como prestador"; D-038 dice que una cuenta con rol de administrador no puede registrarse como prestador. ¿Cuál vale? | Mantener D-038, que es la decisión específica y la que ya aplican la arquitectura y los requisitos (HU-006, criterio 3) | Pendiente; se aplica D-038 |
| 24 | ¿Las experiencias gastronómicas que nombra la sección 3.4 entran al directorio gastronómico, o solo restaurante y café (D-040)? | Ninguna; lo decide la usuaria. Mientras tanto el directorio muestra solo restaurante y café (valor por defecto de la arquitectura) | Pendiente |
| 25 | Texto del aviso al visitante cuando se borra su solicitud porque el prestador revocó (apartado 2.5 del aviso) | Redactarlo y aprobarlo en una sola revisión | Pendiente |
