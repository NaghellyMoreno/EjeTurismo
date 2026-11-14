# Aviso de privacidad: Eje Turismo

Estado del documento: texto aprobado por la usuaria (D-034), con los cambios de D-037 y D-039 aplicados. Sigue sin redactar el aviso al visitante del punto 2.5 (Pendiente 4) y sin decidir el número de versión (Pendiente 5).

Fuentes: borrador de la usuaria entregado el 2026-11-14 (D-008), adaptado de otro proyecto; `docs/00-contexto-producto.md` (secciones 2.3, 3.3, 3.8, 3.12, 3.15, 3.16 y 3.17); registro de decisiones congeladas (D-003, D-007, D-008, D-009, D-010, D-011, D-014, D-015; en la ronda 2, D-018 a D-025; en la ronda 3, D-029, D-030, D-032 y D-033; tras el informe de preparación, D-034 a D-037, D-039 y D-043).

Marcas:
- **Confirmado (borrador):** dato que la usuaria confirmó para conservar.
- **Confirmado (sección X / D-0XX):** sale del contexto o de una decisión congelada.
- **Inferido:** adaptación propuesta por el product-manager; requiere aprobación.
- **Pendiente:** falta información; ver la lista numerada al final.

Las marcas van entre corchetes al final de cada párrafo y se quitan del texto que verá el usuario.

---

## Texto 1: Aviso de privacidad y tratamiento de datos personales

**Eje Turismo. Aviso de privacidad, versión 2026-11-v2. Vigente desde el 2 de noviembre de 2026.** [Confirmado (borrador); número de versión, Pendiente 5]

### 1. Quién trata tus datos
Eje Turismo es un prototipo académico desarrollado por un estudiante de la Universidad de Caldas, en Manizales. [Confirmado (borrador)]

Responsable del tratamiento: Karen Moreno, con domicilio en Manizales, Caldas.
Contacto: correo electrónico karen.moreno35879@ucaldas.edu.co y teléfono 305 382 7085. [Confirmado (borrador)]

Eje Turismo sirve para consultar destinos, atractivos, servicios y experiencias turísticas de Manizales y del Eje Cafetero, a través de un bot de Telegram y de una Mini App que se abre dentro de Telegram. [Confirmado (secciones 2.1, 3.10)]

### 2. Qué datos tratamos
Solo tratamos los datos que necesita cada uso. [Inferido]

- **Todas las personas que usan el bot o la Mini App:** tu ID de Telegram, el nombre de tu cuenta de Telegram y la constancia de que aceptaste este aviso (fecha y hora, canal y versión del aviso). [Inferido a partir de secciones 2.3, 3.12, 3.15 y D-010]
- **Si envías una solicitud de información o interés a un prestador:** tu nombre (se toma de Telegram y lo puedes cambiar), la fecha de interés, el número de personas, tu mensaje y las respuestas que te envíe el prestador. [Confirmado (sección 3.8, D-010)]
- **Si te registras como prestador turístico:** tu número de identidad, vinculado a tu ID de Telegram, y el estado de tu autorización. También la información de tus negocios y fichas (por ejemplo, datos de contacto, horarios, fotografías, ubicación y, en rutas y experiencias, los datos de los guías). [Confirmado (secciones 2.3, 3.3, 3.5, 3.7, D-003, D-014)]
- **Si eres administrador:** tu ID de Telegram, tu nombre de Telegram y el registro de las decisiones que tomas. A los administradores no se les pide número de identidad. Si un administrador te autoriza, guardamos tu ID de Telegram desde ese momento, aunque todavía no hayas aceptado este aviso. [Confirmado (D-007); registro de decisiones, sección 3.12; ID antes de aceptar, Confirmado (D-037)]
- **Para trazabilidad:** fechas, estados y responsables de los cambios importantes (registros, autorizaciones, fichas y solicitudes). [Confirmado (sección 3.12)]

### 3. Para qué usamos tus datos
- Identificarte en el bot y en la Mini App y mostrarte las opciones de tu rol. [Inferido a partir de secciones 2.3, 3.16]
- Verificar la identidad del prestador para que el administrador autorice o rechace su registro. [Confirmado (sección 2.3)]
- Publicar, una vez aprobada por el administrador, la información turística de los negocios. [Confirmado (sección 3.3)]
- Remitir tus solicitudes de información o interés al prestador del negocio, avisarle por Telegram y hacerte llegar su respuesta. Eje Turismo no hace reservas ni cobra pagos; la solicitud no es una reserva confirmada. [Confirmado (secciones 3.8, 3.14)]
- Registrar fechas, estados y responsables para trazabilidad. [Confirmado (sección 3.12); la funcionalidad de reportes no se crea en esta entrega, D-030]
- Proteger la plataforma, verificando en cada operación quién eres y qué puedes hacer. [Confirmado (secciones 3.11, 3.16)]

No usamos tus datos para otras finalidades. [Inferido]

### 4. Quién ve tus datos
- Tu número de identidad solo lo ven los administradores. Nunca se muestra a los visitantes. [Confirmado (D-011, sección 3.15)]
- Los datos de una solicitud solo los ve el prestador del negocio al que la enviaste. [Confirmado (D-011)]
- Los visitantes solo ven la información publicada de las fichas, incluidos los datos de contacto que el prestador decidió publicar. [Confirmado (sección 3.3); datos de contacto, D-003]

### 5. Con quién se comparten
No vendemos ni cedemos tus datos. [Confirmado (borrador)]

Para funcionar, Eje Turismo usa estos proveedores tecnológicos:
- **Telegram**, que transporta los mensajes del bot y de la Mini App y aplica su propia política de privacidad. [Confirmado (borrador); Mini App, Inferido]
- **Supabase**, donde se guarda la base de datos. [Confirmado (sección 3.17)]
- **Vercel**, donde se publica la aplicación. [Confirmado (sección 3.17)]
- **Vercel Blob**, donde se guardan las fotografías de las fichas. [Confirmado (sección 3.17)]

Tus datos se guardan fuera de Colombia: la base de datos, las funciones de la aplicación y las fotografías están en servidores de São Paulo (Brasil). Además, la red de distribución de contenido (CDN) de Vercel puede guardar copias temporales en caché en servidores de otros países. [Confirmado (D-034, D-035)]

La ubicación de cada lugar se muestra con un enlace a Google Maps. Al abrirlo sales de Eje Turismo y se aplica la política de Google. [Confirmado: enlace, sección 3.7; frase sobre la política de Google, aprobada con el texto del aviso (D-034)]

### 6. Cuánto tiempo los conservamos
Conservamos tus datos hasta el 31 de enero de 2027. Ese día se eliminan, incluida la prueba de que autorizaste o revocaste el tratamiento. [Confirmado (borrador, D-021)]

### 7. Tus derechos
De acuerdo con la Ley 1581 de 2012, tienes derecho a: [Confirmado (borrador, sección 3.15)]
- Conocer, actualizar y rectificar tus datos.
- Pedir prueba de la autorización que diste.
- Saber qué uso se les ha dado.
- Revocar la autorización y pedir que se eliminen tus datos.
- Consultar tus datos de forma gratuita.
- Presentar una queja ante la Superintendencia de Industria y Comercio (SIC), después de haber hecho una consulta o un reclamo ante el responsable.

### 8. Cómo ejercer tus derechos
Para consultar o corregir tus datos, escribe al correo electrónico karen.moreno35879@ucaldas.edu.co o llama al 305 382 7085. Estas solicitudes se atienden solo por esos dos canales; el bot y la Mini App no tienen una opción para consultar o corregir datos. [Confirmado (borrador, D-025)]

- Las consultas se responden en máximo 10 días hábiles. Si no es posible en ese plazo, te informaremos el motivo y la respuesta llegará en máximo 5 días hábiles más. [Confirmado (borrador)]
- Los reclamos se responden en máximo 15 días hábiles. Si no es posible en ese plazo, te informaremos el motivo y la respuesta llegará en máximo 8 días hábiles más. [Confirmado (borrador)]

### 9. Cómo revocar tu autorización
En el inicio del bot y en la pantalla inicial de la Mini App encontrarás la opción "Revocar mi autorización". Antes de ejecutarla te pediremos confirmación. [Confirmado (borrador, D-018); confirmación, sección 3.12]

Al revocar:
- Se borran de inmediato tus solicitudes y la vinculación de tu chat de Telegram. Al prestador que recibió cada solicitud le avisamos que ya no está disponible. [Confirmado (borrador, D-019)]
- Si eres prestador, se borran también tu número de identidad y tu registro, y pierdes el rol de prestador. Las fichas que ya estaban publicadas siguen visibles hasta el 31 de enero de 2027, cuando se eliminan, pero dejan de ofrecer la opción "Solicitar información". Las fichas que no estaban publicadas quedan en el estado en que estaban y no son visibles para los visitantes. Las solicitudes que recibieron tus negocios se borran, y a cada persona que envió una le avisamos que ya no está disponible. [Confirmado (D-019, D-021, D-029)]
- Si eres administrador, pierdes el rol de administrador. Si eres el administrador principal de la plataforma o el único administrador, no puedes revocar desde esta opción, y el bot te explica el motivo. [Confirmado (D-020); nombre "administrador principal" para el administrador fijado en la configuración, Confirmado (D-032)]
- Solo guardamos, sin tu número de identidad, la prueba de que autorizaste y revocaste: fecha, canal y versión del aviso. Esa prueba se elimina el 31 de enero de 2027. [Confirmado (borrador, D-021)]
- Si quieres volver a usar Eje Turismo, el bot o la Mini App te mostrarán de nuevo este aviso para que lo aceptes. No necesitas ningún código. [Confirmado (D-018)]

### 10. Si no aceptas este aviso
Si no aceptas, no se registra ningún dato tuyo. Podrás aceptarlo más adelante desde el inicio del bot o de la Mini App. [Confirmado (borrador, D-008); segunda frase aprobada con el texto del aviso (D-034)]

Sin aceptar este aviso no puedes usar el bot ni la Mini App, ni siquiera para explorar fichas. [Confirmado (D-039)]

### 11. Si cambia este aviso
Si publicamos una versión nueva de este aviso, te la mostraremos al abrir el bot o la Mini App y tendrás que aceptarla de nuevo antes de seguir. Si entras por primera vez por la Mini App, verás este mismo aviso. [Confirmado (D-025)]

### 12. Datos de otras personas y menores de edad
- Si entregas datos de otra persona, declaras que tienes su autorización. Si eres prestador, al enviar una ficha a revisión declaras que tienes la autorización de los guías y contactos cuyos datos incluyes. [Confirmado (borrador, D-024)]
- Si haces una solicitud en nombre de otra persona, también declaras que tienes su autorización. [Inferido, ejemplo adaptado del borrador]
- Si eres menor de edad, la autorización la da tu representante legal. [Confirmado (borrador)]

### 13. Política aplicable
Se aplica la Política de Tratamiento de Datos Personales de la Universidad de Caldas (Acuerdo 31 de 2015 del Consejo Superior), disponible en http://sig.ucaldas.edu.co/admiarchigestion/F-8960.PDF. [Confirmado (borrador)]

---

## Texto 2: Autorización, revocación y aviso sobre el número de identidad

Salvo lo marcado como Confirmado, este texto es **Inferido**: el borrador de la usuaria no lo trae. En el bot, "marcar" la declaración equivale a pulsar un botón; en la Mini App puede ser una casilla y un botón. [Inferido]

### 2.1. Declaración de autorización (se muestra debajo del Texto 1, en el bot y en la Mini App)
> Leí el aviso de privacidad de Eje Turismo, versión 2026-11-v2, y autorizo a Karen Moreno a tratar mis datos personales para las finalidades que allí se describen. Si entrego datos de otra persona, declaro que tengo su autorización. Si soy menor de edad, mi representante legal da esta autorización.

[Número de versión: Pendiente 5]

Botones: **"Acepto"** y **"No acepto"**. [Mismo aviso y declaración en la Mini App: Confirmado (D-025)]

- Al pulsar "Acepto": se registra la aceptación con fecha y hora (America/Bogota), canal (bot o Mini App) y versión del aviso, y se muestra el menú inicial. [Inferido; registro, sección 3.12 y F001]
- Al pulsar "No acepto": mensaje "Sin tu autorización no podemos guardar ningún dato. Si cambias de opinión, envía /start para ver de nuevo el aviso." No se guarda ningún dato. [Inferido; regla, D-008]

### 2.2. Opción "Revocar mi autorización" (en el inicio del bot y en la pantalla inicial de la Mini App)
Botón: **"Revocar mi autorización"**. [Confirmado (D-018)]

Frase que se muestra junto a la opción [Confirmado (D-023), texto literal]:
> El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador.

Mensaje de confirmación al pulsar el botón:
> ¿Quieres revocar tu autorización? Se borrarán de inmediato tus solicitudes y la vinculación de tu chat. Si eres prestador, también se borrarán tu número de identidad y tu registro, y perderás el rol; tus fichas ya publicadas seguirán visibles hasta el 31 de enero de 2027, sin la opción "Solicitar información"; tus fichas no publicadas quedarán como están y no serán visibles; y se borrarán las solicitudes que recibieron tus negocios, con un aviso a quien las envió. Si eres administrador, perderás el rol. Solo guardaremos, sin tu número de identidad, la prueba de que autorizaste y revocaste (fecha, canal y versión del aviso), hasta el 31 de enero de 2027. Para volver a usar Eje Turismo tendrás que aceptar el aviso de nuevo.

[Contenido: Confirmado (D-018 a D-021, D-029); redacción, Inferido]

Botones: **"Sí, revocar"** y **"Cancelar"**.

- Al pulsar "Sí, revocar": mensaje "Revocaste tu autorización. Tus datos fueron eliminados." [Inferido]
- Al pulsar "Cancelar": mensaje "No se hizo ningún cambio." y vuelve al menú. [Inferido; cancelación, sección 3.12]
- Si quien pulsa es el administrador fijado en la configuración o el único administrador: mensaje "No puedes revocar tu autorización porque eres el administrador principal o el único administrador de Eje Turismo." No se borra nada. [Regla: Confirmado (D-020); nombre "administrador principal", Confirmado (D-032); resto del texto, Inferido]

### 2.3. Declaración al enviar una ficha a revisión (solo prestadores)
> Declaro que tengo la autorización de las personas cuyos datos incluyo en esta ficha, como guías y contactos.

Botones: **"Declaro y envío"** y **"Cancelar"**. Sin la declaración, la ficha no se envía a revisión. [Regla: Confirmado (D-024); texto y botones, Inferido]

### 2.4. Aviso al prestador cuando se borra una solicitud
> Una solicitud que recibiste ya no está disponible porque la persona que la envió retiró su autorización.

[Regla: Confirmado (D-019); texto, Inferido]

### 2.5. Aviso al visitante cuando se borra su solicitud porque el prestador revocó
Se envía por el bot a cada persona cuya solicitud se borra porque el prestador revocó su autorización. [Regla: Confirmado (D-029)]

[Pendiente 4: texto del aviso sin redactar.]

---

## Pendientes

1. **Resuelto (D-034, D-035):** los servidores están en São Paulo (Brasil) y el apartado 5 menciona la transferencia internacional. No se cita otra norma sin confirmación de la usuaria (sección 3.15). Se conserva el número para no cambiar las referencias.
2. **Resuelto (D-034):** la frase sobre Google Maps se aprobó con el texto del aviso. Se conserva el número para no cambiar las referencias.
3. **Retirado:** el nombre "administrador principal" quedó Confirmado (D-032). Se conserva el número para no cambiar las referencias.
4. **Aviso al visitante del punto 2.5.** La redacción propuesta del Texto 2 quedó aprobada con el aviso (D-034), pero el texto del aviso al visitante cuando se borra su solicitud porque el prestador revocó sigue sin redactar. Pendiente.
5. **Número de versión del aviso.** El texto cambió (D-034, D-037, D-039), pero la versión sigue como "2026-11-v2" en el Texto 1 y en la declaración del punto 2.1. ¿Se mantiene "2026-11-v2" o pasa a "2026-11-v3"? Pendiente: decide la usuaria; no se cambia hasta entonces.

Resueltos en la ronda 3 y retirados de esta lista: efectos de la revocación del prestador sobre sus fichas y solicitudes (D-029), retiro de los reportes básicos de las finalidades (D-030) y nombre "administrador principal" (D-032).

Resueltos en la ronda 2 y retirados de esta lista: canal de revocación sin "web" (D-018), retiro de "pide código nuevo" (D-018), qué se borra al revocar un prestador o un visitante (D-019), revocación del administrador y nombre "Revocar rol" (D-020), fecha de eliminación y plazo de la prueba (D-021), datos de terceros en las fichas (D-024), frase sobre el número de identidad (D-023), cambio de versión, aviso en la Mini App y canales de consulta y corrección (D-025), e historia y funcionalidad de revocación (HU-030; F034 a F037).
