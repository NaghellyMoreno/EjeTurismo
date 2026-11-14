# Guía de agentes: Eje Turismo

Reglas propias de este proyecto para cada agente. Complementan los agentes y skills genéricos del sistema; si algo de aquí choca con el contexto, manda el contexto.

Marcas: **[Confirmado]** sale de la fuente; **[Inferido]** requiere aprobación; **[Pendiente]** falta decidir.

## product-manager
- **[Confirmado]** Prioriza las funcionalidades esenciales y los procesos principales: registrar contenido (administrador y prestador), organizarlo por municipio, categoría y tipo de experiencia, y que el visitante lo consulte por Telegram (sección 3.9).
- **[Inferido]** Orden del recorrido: roles y permisos, municipios y categorías, atractivos, establecimientos, gastronomía, rutas y experiencias, eventos, galería y ubicación, solicitudes (última, por ser opcional).
- Canal: Telegram. No propongas interfaces web como canal principal.
- Error común: convertir las solicitudes de reserva en un motor de reservas o pagos. Está fuera de alcance (sección 3.14).
- Cada historia debe tener criterios de aceptación verificables y trazables a una sección del contexto.
- **[Pendiente]** Cifras exactas que no se pueden aproximar (límites de fotos, de fichas, de caracteres) y prioridad por módulo.

## architect
- **[Confirmado]** Decisiones obligatorias: backend concentra lógica y autorización; el bot es solo interfaz; separación de datos por negocio; trazabilidad (fechas, estados, responsables); funcionamiento independiente de otros aplicativos.
- **[Confirmado]** El modelo de datos y los componentes principales son entregables: documéntalos con claridad.
- Error común de la plataforma: confiar en el `chat_id` de Telegram como prueba de rol sin verificarlo en el backend; validar el origen de los datos de una Mini App si se usa.
- Error común del dominio: modelar prestador y establecimiento como lo mismo, o permitir editar contenido de otro negocio.
- **[Confirmado por la usuaria]** Publicación en Vercel; hay Mini App y solicitudes de información en el alcance; los roles se asignan por ID de Telegram autorizado por el administrador.
- **[Inferido]** Diseña para serverless: bot por webhook, sin disco local, base de datos y fotografías en servicios externos; el backend valida `initData` de la Mini App.
- **[Confirmado por la usuaria]** Stack: TypeScript, Next.js, grammY (webhook), Supabase (PostgreSQL), Vercel Blob, enlace a Google Maps.
- **[Confirmado por la usuaria]** El modelo de datos debe permitir una versión publicada y una versión pendiente de la misma ficha; la publicada sigue visible hasta la aprobación.
- Error común: sobrescribir la ficha publicada al editar, en vez de crear la versión pendiente.
- **[Confirmado por la usuaria]** Los datos personales se tratan conforme a la Ley 1581 de 2012; el aviso de privacidad se muestra y se acepta antes de recolectar datos.
- El número de identidad del prestador es dato personal: no se muestra al visitante ni se registra en logs.

## readiness-reviewer
- Verifica que cada requisito indique rol autorizado y se pueda rastrear a una sección del contexto.
- Verifica que existan reglas de separación por negocio, validación del prestador, prevención de duplicados, manejo de errores y cancelaciones.
- Verifica que ningún requisito exija reservas completas, pagos ni integraciones obligatorias.
- Rechaza (CONCERNS o FAIL) cualquier decisión de stack no confirmada por la usuaria.

## developer
- Zona horaria America/Bogota **[Inferido]**.
- Textos visibles en español; identificadores en inglés.
- Todo control de permisos va en el backend, con prueba, antes de exponerlo en el bot.
- Mensajes claros y confirmación antes de operaciones importantes (editar, eliminar, publicar).
- Credenciales y token del bot solo en `.env`.
- **[Pendiente]** Datos de prueba (municipios, prestadores y atractivos de ejemplo), cómo instalar dependencias en una copia nueva y cómo evitar puertos y bases de datos fijos en el modo paralelo.

## qa-evaluator
Pruebas obligatorias propias del dominio **[Inferido a partir de la sección 3.12; por aprobar]**:
- Un prestador no puede ver ni editar el contenido de otro negocio.
- Un visitante no puede ejecutar acciones de administrador ni de prestador (verificado contra el backend, no solo el bot).
- Contenido sin validar no se presenta como confiable al visitante.
- Al editar una ficha publicada, el visitante sigue viendo la versión anterior hasta la aprobación de la nueva.
- El prestador recibe la alerta de Telegram al llegar una solicitud, y la solicitud pasa por nueva, atendida y cerrada.
- Registro duplicado o inconsistente es rechazado.
- Flujo del visitante: explorar por municipio y categoría, ver ficha, abrir ubicación, ver horarios y contacto.
- Cancelación de formularios conversacionales y manejo de entradas inválidas.
- Datos personales solo accesibles a quien está autorizado.
- Evidencias de pruebas guardadas, porque son un entregable.
