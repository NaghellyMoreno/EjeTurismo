-- Datos de referencia que van a todos los entornos, incluida producción (ADR 0011). Idempotente.
-- Aviso de privacidad vigente "2026-11-v3" (D-034, D-050, D-056): el texto sale de docs/05-aviso-privacidad.md
-- sin cambios de redacción y sin las marcas de anotación. El marcador "[fecha de publicación en producción]"
-- se conserva: la interfaz lo reemplaza por published_at en America/Bogota (ADR 0005).
-- published_at es el momento de la carga (D-050). Si ya hay otra versión vigente, esta se carga como no vigente.
insert into app.privacy_notice_versions (version, body_markdown, declaration_text, revocation_note, published_at, is_current)
select
  '2026-11-v3',
  $aviso$**Eje Turismo. Aviso de privacidad, versión 2026-11-v3. Vigente desde [fecha de publicación en producción].**

### 1. Quién trata tus datos
Eje Turismo es un prototipo académico desarrollado por un estudiante de la Universidad de Caldas, en Manizales.

Responsable del tratamiento: Karen Moreno, con domicilio en Manizales, Caldas.
Contacto: correo electrónico karen.moreno35879@ucaldas.edu.co y teléfono 305 382 7085.

Eje Turismo sirve para consultar destinos, atractivos, servicios y experiencias turísticas de Manizales y del Eje Cafetero, a través de un bot de Telegram y de una Mini App que se abre dentro de Telegram.

### 2. Qué datos tratamos
Solo tratamos los datos que necesita cada uso.

- **Todas las personas que usan el bot o la Mini App:** tu ID de Telegram, el nombre de tu cuenta de Telegram y la constancia de que aceptaste este aviso (fecha y hora, canal y versión del aviso).
- **Si envías una solicitud de información o interés a un prestador:** tu nombre (se toma de Telegram y lo puedes cambiar), la fecha de interés, el número de personas, tu mensaje y las respuestas que te envíe el prestador.
- **Si te registras como prestador turístico:** tu tipo y número de documento de identidad, vinculados a tu ID de Telegram, y el estado de tu autorización. También la información de tus negocios y fichas (por ejemplo, datos de contacto, horarios, fotografías, ubicación y, en rutas y experiencias, los datos de los guías).
- **Si eres administrador:** tu ID de Telegram, tu nombre de Telegram y el registro de las decisiones que tomas. A los administradores no se les pide número de identidad. Si un administrador te autoriza, guardamos tu ID de Telegram desde ese momento, aunque todavía no hayas aceptado este aviso.
- **Para trazabilidad:** fechas, estados y responsables de los cambios importantes (registros, autorizaciones, fichas y solicitudes).

### 3. Para qué usamos tus datos
- Identificarte en el bot y en la Mini App y mostrarte las opciones de tu rol.
- Verificar la identidad del prestador para que el administrador autorice o rechace su registro.
- Publicar, una vez aprobada por el administrador, la información turística de los negocios.
- Remitir tus solicitudes de información o interés al prestador del negocio, avisarle por Telegram y hacerte llegar su respuesta. Eje Turismo no hace reservas ni cobra pagos; la solicitud no es una reserva confirmada.
- Registrar fechas, estados y responsables para trazabilidad.
- Proteger la plataforma, verificando en cada operación quién eres y qué puedes hacer.

No usamos tus datos para otras finalidades.

### 4. Quién ve tus datos
- Tu número de identidad solo lo ven los administradores. Nunca se muestra a los visitantes.
- Los datos de una solicitud solo los ve el prestador del negocio al que la enviaste.
- Los visitantes solo ven la información publicada de las fichas, incluidos los datos de contacto que el prestador decidió publicar.

### 5. Con quién se comparten
No vendemos ni cedemos tus datos.

Para funcionar, Eje Turismo usa estos proveedores tecnológicos:
- **Telegram**, que transporta los mensajes del bot y de la Mini App y aplica su propia política de privacidad.
- **Supabase**, donde se guarda la base de datos.
- **Vercel**, donde se publica la aplicación.
- **Vercel Blob**, donde se guardan las fotografías de las fichas.

Tus datos se guardan fuera de Colombia: la base de datos, las funciones de la aplicación y las fotografías están en servidores de São Paulo (Brasil). Además, la red de distribución de contenido (CDN) de Vercel puede guardar copias temporales en caché en servidores de otros países.

La ubicación de cada lugar se muestra con un enlace a Google Maps. Al abrirlo sales de Eje Turismo y se aplica la política de Google.

### 6. Cuánto tiempo los conservamos
Conservamos tus datos hasta el 31 de enero de 2027. Ese día se eliminan, incluida la prueba de que autorizaste o revocaste el tratamiento.

### 7. Tus derechos
De acuerdo con la Ley 1581 de 2012, tienes derecho a:
- Conocer, actualizar y rectificar tus datos.
- Pedir prueba de la autorización que diste.
- Saber qué uso se les ha dado.
- Revocar la autorización y pedir que se eliminen tus datos.
- Consultar tus datos de forma gratuita.
- Presentar una queja ante la Superintendencia de Industria y Comercio (SIC), después de haber hecho una consulta o un reclamo ante el responsable.

### 8. Cómo ejercer tus derechos
Para consultar o corregir tus datos, escribe al correo electrónico karen.moreno35879@ucaldas.edu.co o llama al 305 382 7085. Estas solicitudes se atienden solo por esos dos canales; el bot y la Mini App no tienen una opción para consultar o corregir datos.

- Las consultas se responden en máximo 10 días hábiles. Si no es posible en ese plazo, te informaremos el motivo y la respuesta llegará en máximo 5 días hábiles más.
- Los reclamos se responden en máximo 15 días hábiles. Si no es posible en ese plazo, te informaremos el motivo y la respuesta llegará en máximo 8 días hábiles más.

### 9. Cómo revocar tu autorización
En el inicio del bot y en la pantalla inicial de la Mini App encontrarás la opción "Revocar mi autorización". Antes de ejecutarla te pediremos confirmación.

Al revocar:
- Se borran de inmediato tus solicitudes y la vinculación de tu chat de Telegram. Al prestador que recibió cada solicitud le avisamos que ya no está disponible.
- Si eres prestador, se borran también tu número de identidad y tu registro, y pierdes el rol de prestador. Las fichas que ya estaban publicadas siguen visibles hasta el 31 de enero de 2027, cuando se eliminan, pero dejan de ofrecer la opción "Solicitar información". Las fichas que no estaban publicadas quedan en el estado en que estaban y no son visibles para los visitantes. Las solicitudes que recibieron tus negocios se borran, y a cada persona que envió una le avisamos que ya no está disponible.
- Si eres administrador, pierdes el rol de administrador. Si eres el administrador principal de la plataforma o el único administrador, no puedes revocar desde esta opción, y el bot te explica el motivo.
- Solo guardamos, sin tu número de identidad, la prueba de que autorizaste y revocaste: fecha, canal y versión del aviso. Esa prueba se elimina el 31 de enero de 2027.
- Si quieres volver a usar Eje Turismo, el bot o la Mini App te mostrarán de nuevo este aviso para que lo aceptes. No necesitas ningún código.

### 10. Si no aceptas este aviso
Si no aceptas, no se registra ningún dato tuyo. Podrás aceptarlo más adelante desde el inicio del bot o de la Mini App.

Sin aceptar este aviso no puedes usar el bot ni la Mini App, ni siquiera para explorar fichas.

### 11. Si cambia este aviso
Si publicamos una versión nueva de este aviso, te la mostraremos al abrir el bot o la Mini App y tendrás que aceptarla de nuevo antes de seguir. Si entras por primera vez por la Mini App, verás este mismo aviso.

### 12. Datos de otras personas y menores de edad
- Si entregas datos de otra persona, declaras que tienes su autorización. Si eres prestador, al enviar una ficha a revisión declaras que tienes la autorización de los guías y contactos cuyos datos incluyes.
- Si haces una solicitud en nombre de otra persona, también declaras que tienes su autorización.
- Si eres menor de edad, la autorización la da tu representante legal.

### 13. Política aplicable
Se aplica la Política de Tratamiento de Datos Personales de la Universidad de Caldas (Acuerdo 31 de 2015 del Consejo Superior), disponible en http://sig.ucaldas.edu.co/admiarchigestion/F-8960.PDF.$aviso$,
  $aviso$Leí el aviso de privacidad de Eje Turismo, versión 2026-11-v3, y autorizo a Karen Moreno a tratar mis datos personales para las finalidades que allí se describen. Si entrego datos de otra persona, declaro que tengo su autorización. Si soy menor de edad, mi representante legal da esta autorización.$aviso$,
  $aviso$El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador.$aviso$,
  now(),
  not exists (select 1 from app.privacy_notice_versions where is_current)
on conflict (version) do nothing;
