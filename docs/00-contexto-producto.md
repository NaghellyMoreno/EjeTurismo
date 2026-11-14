# Eje Turismo - Contexto para agentes de IA

Versión: 1
Estado: Borrador
Propósito: dar a cualquier agente de IA las reglas de trabajo, el dominio y el contexto del producto.

Fuente: *Proyecto Final – Asignación y descripción de los aplicativos* (Ingeniería de Software 3, Universidad de Caldas), recogido en `docs/Eje_Turismo.md`.

Convención de marcas: **[Confirmado]** viene de la fuente; **[Inferido]** es una deducción que requiere aprobación; **[Pendiente]** falta información y hay que preguntar.

# 1. Reglas de trabajo

1. Redactar en español.
2. La IA propone y la responsable del proyecto decide y valida.
3. Si falta información, preguntar. No completar vacíos con suposiciones ni inventar reglas, cifras, normas, integraciones o comportamientos.
4. Distinguir en toda respuesta lo Confirmado, lo Inferido y lo Pendiente. Una inferencia nunca se convierte en regla sin aprobación.
5. Si una solicitud contradice el contexto del producto, señalar la contradicción y preguntar antes de continuar.

# 2. Dominio

## 2.1. Producto
**[Confirmado]** Eje Turismo es una plataforma para facilitar la promoción, consulta y descubrimiento de destinos, atractivos, servicios y experiencias turísticas de Manizales y los municipios del Eje Cafetero. Su interfaz principal es un bot de Telegram.

## 2.2. Problema
**[Confirmado]** La información turística está dispersa en redes sociales, páginas y contactos individuales. El visitante necesita información organizada y confiable sobre lugares, actividades, servicios, ubicación y formas de contacto.

## 2.3. Actores
**[Confirmado]**

| Rol | Responsabilidades |
|---|---|
| Administrador de la plataforma | Gestiona municipios, categorías, contenidos, publicaciones y usuarios autorizados. |
| Prestador u operador turístico | Registra o actualiza la información de su establecimiento, servicio o experiencia, sujeto a validación. |
| Visitante o turista | Explora destinos, consulta atractivos, revisa fotografías, ubicación, horarios y datos de contacto. |

**[Confirmado por la usuaria]** Solo el administrador valida lo que registra el prestador. El administrador autoriza el ID de Telegram de cada administrador y prestador; ese ID es la base de la identidad y el rol.
**[Confirmado por la usuaria]** El prestador hace un registro inicial con su número de identidad y después entra con facilidad (sin repetir el registro).
**[Confirmado por la usuaria]** El registro inicial vincula el número de identidad con el ID de Telegram y queda a la espera de autorización del administrador. El visitante no necesita registro.
**[Pendiente]** Si el registro con número de identidad aplica también a los administradores.

## 2.4. Glosario
- **Municipio:** unidad territorial de Manizales o del Eje Cafetero que organiza el contenido. **[Confirmado]**
- **Destino / atractivo turístico:** sitio natural, cultural, histórico o patrimonial con ficha propia. **[Confirmado]**
- **Prestador u operador turístico:** quien ofrece un establecimiento, servicio o experiencia. **[Confirmado]**
- **Establecimiento:** hotel, finca cafetera, alojamiento rural, restaurante, café u otro servicio turístico. **[Confirmado]**
- **Solicitud:** petición de información o manifestación de interés en una reserva, remitida al prestador. **[Confirmado]**
- **Negocio:** unidad cuya información debe mantenerse separada de la de otros. **[Inferido]** (la fuente dice "negocio o establecimiento")
- **Pendiente:** definir los términos "categoría" y "tipo de experiencia" (lista cerrada o libre).

# 3. Contexto del producto

## 3.1. Municipios y destinos
**[Confirmado]** Información general de municipios, zonas y destinos turísticos.
**[Pendiente]** Lista de municipios del alcance inicial y si "zona" es una entidad propia.

## 3.2. Atractivos turísticos
**[Confirmado]** Fichas de sitios naturales, culturales, históricos y patrimoniales.
**[Pendiente]** Campos obligatorios de la ficha.

## 3.3. Establecimientos y alojamientos
**[Confirmado]** Hoteles, fincas cafeteras, alojamientos rurales y otros servicios turísticos.
**[Confirmado por la usuaria]** Estados de validación del contenido registrado por prestadores: borrador, pendiente, publicada, rechazada. Solo el administrador cambia el estado de pendiente a publicada o rechazada; solo las fichas publicadas se muestran al visitante.
**[Confirmado por la usuaria]** Cuando se edita una ficha publicada, la versión anterior sigue visible al visitante hasta que el administrador apruebe la nueva. Por tanto, una ficha puede tener a la vez una versión publicada y una versión pendiente de aprobación.
**[Confirmado por la usuaria]** El rechazo lleva un motivo que el prestador puede leer. Si se rechaza una versión pendiente, se descarta y se conserva la publicada.
**[Pendiente]** Campos de cada ficha y tipos de establecimiento.

## 3.4. Gastronomía y restaurantes
**[Confirmado]** Directorio de restaurantes, cafés y experiencias gastronómicas.

## 3.5. Rutas y experiencias
**[Confirmado]** Recorridos, actividades, guías, operadores y experiencias disponibles.
**[Pendiente]** Si los guías son usuarios del sistema o solo datos de la ficha.

## 3.6. Eventos
**[Confirmado]** Agenda de festividades, actividades culturales, ferias y eventos turísticos.
**[Pendiente]** Si hay notificaciones de eventos a los visitantes.

## 3.7. Galería y georreferenciación
**[Confirmado]** Fotografías, mapas, ubicación y datos para orientar al visitante; el visitante puede abrir la ubicación.
**[Confirmado por la usuaria]** La ubicación se muestra con un enlace a Google Maps.
**[Pendiente]** Límites de fotos por ficha.

## 3.8. Contacto y solicitudes
**[Confirmado]** Canales de contacto y formularios o conversaciones para solicitar información o manifestar interés en una reserva. Las solicitudes de reserva pueden remitirse al prestador para su confirmación. El registro de solicitudes se hace "cuando se habilite esta función".
**[Confirmado por la usuaria]** Las solicitudes de información o interés entran en el alcance de esta entrega.
**[Confirmado por la usuaria]**
- Datos del formulario: nombre, fecha de interés, número de personas y mensaje.
- El prestador recibe una alerta en Telegram cuando llega una solicitud.
- Estados de la solicitud: nueva, atendida, cerrada.
**[Confirmado por la usuaria]** Solo el prestador cambia el estado de la solicitud. El visitante recibe la respuesta del prestador por el bot.
**[Pendiente]** Si el nombre del formulario es el de Telegram o se escribe, y si la respuesta del prestador es texto libre.

## 3.9. Flujo general de operación
**[Confirmado]**
1. El administrador o prestador autorizado registra la información del destino o servicio.
2. La plataforma organiza el contenido por municipio, categoría y tipo de experiencia.
3. El visitante consulta opciones mediante Telegram y revisa sus detalles.
4. El visitante puede abrir la ubicación, consultar horarios y contactar al prestador.
5. La plataforma registra solicitudes de información o interés cuando se habilite esta función.

## 3.10. Telegram como interfaz principal
**[Confirmado]** Telegram es el canal principal mediante un bot: comandos, botones, menús, formularios conversacionales, mensajes, fotografías, documentos y notificaciones. Si se requiere una interfaz visual más amplia, se puede incorporar una Telegram Mini App integrada al flujo de Telegram.
**[Confirmado por la usuaria]** La Mini App entra en el alcance de esta entrega.
**[Pendiente]** Qué flujos van en la Mini App y cuáles quedan en el bot (**[Inferido]**: catálogo con fotos y mapa, y formularios largos del prestador y del administrador en la Mini App).

## 3.11. Responsabilidades del backend
**[Confirmado]**
- El backend concentra la lógica de negocio, validaciones, reglas, autenticación, autorización, persistencia y comunicación con servicios externos.
- No se confían controles críticos únicamente a la interfaz del bot.
- Cada operación verifica el usuario, su rol, el negocio al que pertenece y los permisos.
- La solución funciona de manera independiente; las integraciones con otros aplicativos son complementarias, no requisito.

## 3.12. Criterios comunes de diseño
**[Confirmado]**
- Separación de la información de cada negocio o establecimiento.
- Gestión de usuarios, roles y permisos según responsabilidades reales.
- Validación de datos y prevención de registros duplicados o inconsistentes.
- Registro de fechas, estados y responsables para trazabilidad.
- Mensajes claros y confirmaciones antes de operaciones importantes.
- Manejo de errores, cancelaciones y situaciones excepcionales.
- Reportes básicos para consultar la operación y apoyar decisiones.
- Protección de datos personales y acceso solo a información autorizada.

**[Pendiente]** Qué reportes básicos concretos se esperan.

## 3.13. Restricciones del proyecto
**[Confirmado]**
- Metodología Spec-Driven Development: el desarrollo parte de especificaciones claras, verificables y actualizadas, no de prompts aislados.
- Proyecto individual, con entregables: especificación funcional y criterios de aceptación, especificación técnica y arquitectura, modelo de datos y componentes, evidencias del uso de agentes de IA, código fuente ejecutable, plan y evidencias de pruebas, manual breve y documentación técnica, demostración funcional.
- Criterios de valoración: trazabilidad de especificaciones, correspondencia requisitos-implementación-aceptación, procesos principales y reglas de negocio, calidad del código, uso crítico y documentado de agentes de IA, pruebas, documentación y demostración.

**[Pendiente]** Fecha de entrega, tecnologías obligatorias y tamaño del alcance (priorización de funcionalidades esenciales).

## 3.14. Fuera de alcance
**[Confirmado]** No es obligatorio construir un motor completo de reservas, pagos o administración hotelera. El aplicativo prioriza la promoción y el descubrimiento de la oferta turística.

## 3.15. Contexto normativo
**[Confirmado por la usuaria]** El tratamiento de datos personales se rige por la Ley 1581 de 2012. Al inicio del uso se presenta un aviso de privacidad y tratamiento de datos, que el usuario acepta.
**[Pendiente]** Texto del aviso, finalidad, tiempo de conservación y mecanismo para consultar, corregir o eliminar datos. No se citará ninguna otra norma sin confirmación.

## 3.16. Seguridad
**[Confirmado]** Autenticación y autorización en el backend; verificación de usuario, rol y negocio en cada operación; acceso solo a información autorizada; protección de datos personales.
**[Confirmado por la usuaria]** Los roles se asignan autorizando el ID de Telegram.
**[Inferido]** En la Mini App, el backend valida la firma de los datos de inicio de Telegram (`initData`) en cada petición.
**[Pendiente]** Manejo de datos personales: el número de identidad del prestador y los datos del formulario del visitante son datos personales (sección 3.15); falta definir cómo se almacenan y quién los ve.

## 3.17. Publicación
**[Confirmado por la usuaria]** Se despliega en Vercel. No hay tecnologías obligatorias.
**[Inferido]** Restricciones de Vercel: funciones serverless sin proceso permanente, por lo que el bot recibe mensajes por webhook y no por polling; sin disco persistente, por lo que base de datos y fotografías van en servicios externos; el token del bot va en variables de entorno.
**[Confirmado por la usuaria]** Stack aprobado: TypeScript; Next.js (backend con rutas API y Mini App en el mismo proyecto); grammY por webhook para el bot; PostgreSQL en Supabase; Vercel Blob para fotografías; enlace a Google Maps.
