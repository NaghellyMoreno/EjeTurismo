const PRINCIPAL_MARK = "administrador principal";

// Textos del bot en español. Cada texto aprobado se copia sin cambios de redacción (D-067, D-071, D-079).
export const es = {
  notice: {
    accept: "Acepto",
    decline: "No acepto",
  },
  decline: {
    // Apartado 2.1 de docs/05-aviso-privacidad.md (D-067).
    text: "Sin tu autorización no podemos guardar ningún dato. Si cambias de opinión, envía /start para ver de nuevo el aviso.",
    showAgain: "Volver a ver el aviso",
  },
  menu: {
    // B02, menú mínimo (D-068, D-071). El botón de registro solo lo ven cuentas sin rol y sin registro (D-074).
    welcome: "Te damos la bienvenida a Eje Turismo.\n\nComandos disponibles:\n/start: mostrar este menú",
    registerButton: "Registrarme como prestador",
    // Mínimo de B02 para quien ya tiene el permiso de prestador (D-090, D-091); el menú completo es de F005.
    providerAvailable: "Ya tienes el rol de prestador. Las opciones de prestador estarán disponibles pronto.",
    // F014: botón B06 del administrador y botón B12 del prestador.
    reviews: "Fichas por revisar",
    history: "Historial de fichas",
    myListings: "Mis fichas",
    // F022: opción de visitante de B02 (D-114); la ven todas las cuentas con el aviso vigente.
    exploreButton: "Explorar",
  },
  // B15 (F022): explorar por municipio y categoría. Solo nombres de municipios, categorías y fichas publicadas.
  explore: {
    chooseMunicipality: "Elige un municipio para explorar.",
    chooseCategory: (municipality: string) => `Elige una categoría en ${municipality}.`,
    listHeader: (municipality: string, category: string) => `Fichas publicadas en ${municipality}, categoría ${category}:`,
    empty: (municipality: string, category: string) => `Todavía no hay fichas publicadas en ${municipality} para la categoría ${category}.`,
    noMunicipalities: "Todavía no hay municipios disponibles para explorar.",
    more: "Ver más",
    back: "Volver",
    stale: "Esa opción ya no está disponible. Empieza a explorar de nuevo.",
    startOver: "Empezar de nuevo",
    // B18 (F017), textos aprobados en D-177.
    gastronomicButton: "Directorio gastronómico",
    gastronomicHeader: (municipality: string) => `Directorio gastronómico de ${municipality}`,
    gastronomicEmpty: "Aún no hay restaurantes, cafés ni experiencias gastronómicas publicadas en este municipio.",
    // B17 (F024), textos aprobados en D-180.
    experienceButton: "Rutas y experiencias",
    chooseExperienceType: (municipality: string) => `Elige un tipo de experiencia en ${municipality}.`,
    experienceHeader: (type: string, municipality: string) => `Rutas y experiencias de tipo ${type} en ${municipality}:`,
    experienceEmpty: (type: string, municipality: string) => `Todavía no hay rutas ni experiencias publicadas de tipo ${type} en ${municipality}.`,
    noExperienceTypes: "Todavía no hay tipos de experiencia disponibles.",
  },
  // B04, B05 y B21 mínimo del registro de prestador. Textos aprobados en D-079; ninguno incluye el número ni lo escrito por la persona.
  provider: {
    askType: "Para registrarte como prestador, elige tu tipo de documento de identidad.",
    typeButtons: {
      CC: "CC: cédula de ciudadanía",
      CE: "CE: cédula de extranjería",
      PPT: "PPT: Permiso por Protección Temporal",
      PA: "PA: pasaporte",
    },
    typeInvalid: "Solo se aceptan estos tipos de documento: CC, CE, PPT y PA. Elige uno de los botones o escribe su sigla.",
    askNumber: "Escribe tu número de identidad, tal como aparece en tu documento.",
    numberInvalid: "No pude recibir ese número: no puede estar vacío ni tener caracteres no permitidos. Escríbelo de nuevo.",
    confirm: (typeName: string) =>
      `Vas a registrarte como prestador con tu documento de tipo ${typeName}. Tu número de identidad quedó guardado de forma protegida. ¿Confirmas el registro?`,
    confirmButton: "Confirmar",
    cancelButton: "Cancelar",
    cancelled: "No se guardó nada. Puedes volver a empezar cuando quieras.",
    expired: "El tiempo para confirmar venció y tu número de identidad se descartó. Escríbelo de nuevo para continuar.",
    noDraft: "No hay ningún registro por confirmar.",
    duplicate: "Ese documento ya está registrado. Si crees que es un error, comunícate con el administrador.",
    // B05. Sin la frase "Te avisaremos cuando haya una decisión" (D-079): depende de F003.
    pending: "Tu registro como prestador queda a la espera de autorización del administrador.",
    rateLimited: "Hiciste demasiados intentos. Espera un momento y vuelve a intentarlo.",
    error: "No pude completar el registro. Inténtalo de nuevo más tarde.",
    // B20: avisos al usuario tras la decisión (D-090). Nunca incluyen el tipo, el número ni el motivo.
    approved: "Tu registro como prestador fue autorizado. Escribe /start para continuar.",
    rejected: "Tu registro como prestador no fue autorizado. Si crees que es un error, comunícate con el administrador.",
    // B20 (F014): avisos al prestador tras revisar una ficha. El rechazo lleva el motivo escrito por el administrador (P1).
    listingApproved: (name: string) => `Tu ficha «${name}» fue aprobada y ya es visible para los visitantes.`,
    listingRejected: (name: string, reason: string) =>
      `Tu ficha «${name}» fue rechazada. Motivo: ${reason}. Puedes corregirla y volver a enviarla desde la Mini App.`,
    // B20 (F015, D-154): avisos tras revisar un cambio a una ficha ya publicada.
    editApproved: (name: string) => `Tu cambio a la ficha «${name}» fue aprobado y ya es visible para los visitantes.`,
    editRejected: (name: string, reason: string) =>
      `Tu cambio a la ficha «${name}» fue rechazado. Motivo: ${reason}. La versión publicada sigue visible. Puedes corregirlo y volver a enviarlo desde la Mini App.`,
  },
  // B10 (F014): revisión de fichas pendientes por el administrador. Los avisos de esta pantalla no llevan datos personales.
  review: {
    empty: "No hay fichas por revisar.",
    listTitle: "Fichas por revisar",
    morePending: "Hay más fichas por revisar. Decide algunas y vuelve a pulsar «Fichas por revisar».",
    changed: (fields: string) => `Cambios: ${fields}`,
    firstReview: "Es la primera revisión de esta ficha.",
    approve: "Aprobar",
    reject: "Rechazar",
    confirmApprove: (name: string) => `Vas a aprobar «${name}». Quedará publicada y visible para los visitantes. ¿Confirmas?`,
    yesApprove: "Sí, aprobar",
    yesReject: "Sí, rechazar",
    cancel: "Cancelar",
    askReason: "Escribe el motivo del rechazo. El prestador lo verá. Máximo 4096 caracteres.",
    reasonInvalid: "El motivo es obligatorio y debe ser un texto de hasta 4096 caracteres.",
    confirmReject: (name: string, reason: string) => `Vas a rechazar «${name}» con este motivo: ${reason}. ¿Confirmas?`,
    approved: "Ficha aprobada y publicada.",
    rejected: "Ficha rechazada. El prestador recibirá el motivo.",
    cancelled: "Revisión cancelada. No se hizo ningún cambio.",
    alreadyDecided: "Esa ficha ya fue decidida. Vuelve a abrir «Fichas por revisar».",
    notFound: "No encontramos esa ficha. Vuelve a abrir «Fichas por revisar».",
    ownerRevoked: "El prestador ya no tiene el permiso, así que esta ficha no se puede aprobar.",
    sessionExpired: "La revisión venció. Vuelve a abrir «Fichas por revisar».",
    genericError: "No pudimos completar la revisión. Inténtalo de nuevo en unos minutos.",
    // Etiquetas de B10: las de los campos repiten las ya aprobadas de la Mini App (D-147).
    kinds: { attraction: "Atractivo", establishment: "Establecimiento", route_experience: "Ruta o experiencia" },
    fields: {
      name: "Nombre",
      municipality: "Municipio",
      category: "Categoría",
      establishmentType: "Tipo de establecimiento",
      experienceType: "Tipo de experiencia",
      description: "Descripción",
      schedule: "Horarios",
      contact: "Contacto",
      mapsUrl: "Enlace de Google Maps",
      guidesInfo: "Información de guías",
      photos: "Fotografías",
    },
  },
  // B11 (F029): historial de estados de una ficha para el administrador. Sin número de identidad ni ID de Telegram.
  history: {
    listTitle: "Historial de fichas",
    empty: "Todavía no hay fichas.",
    moreListings: "Hay más fichas. Muestro las 10 más recientes.",
    notFound: "No encontramos esa ficha. Vuelve a abrir «Historial de fichas».",
    title: (name: string) => `Historial de «${name}»`,
    created: "Creada como borrador",
    createdAs: (status: string) => `Creada como ${status.toLowerCase()}`,
    reasonLabel: "Motivo",
    actorRemoved: "Usuario eliminado",
    genericError: "No pudimos mostrar el historial. Intenta de nuevo.",
    // "Reemplazada" es la etiqueta de `superseded` (versión publicada sustituida, F015), que `status.*` no trae.
    statuses: { draft: "Borrador", pending: "Pendiente de revisión", published: "Publicada", rejected: "Rechazada", superseded: "Reemplazada" },
  },
  // B12 (F014): mis fichas del prestador, solo lectura; crear y editar es de la Mini App (D-002).
  myListings: {
    title: "Tus fichas",
    empty: "Todavía no tienes fichas. Crea una desde la Mini App.",
    line: (name: string, status: string) => `«${name}»: ${status}`,
    reason: (reason: string) => `Motivo del rechazo: ${reason}`,
    stillVisible: "La versión publicada sigue visible.",
    open: "Abrir la Mini App",
    statuses: { draft: "Borrador", pending: "Pendiente de revisión", published: "Publicada", rejected: "Rechazada" },
  },
  // B06, B07: revisión de registros de prestadores por el administrador (D-090, D-096).
  admin: {
    pendingButton: "Registros pendientes",
    authorizeButton: "Autorizar administrador",
    noPending: "No hay registros de prestadores pendientes.",
    registrationDetail: (d: { telegramUserId: string; displayName: string; typeName: string; number: string; createdAt: string }) =>
      `Registro de prestador pendiente\nID de Telegram: ${d.telegramUserId}\nNombre de Telegram: ${d.displayName}\nDocumento: ${d.typeName}\nNúmero de identidad: ${d.number}\nFecha de registro: ${d.createdAt}`,
    approveButton: "Autorizar",
    rejectButton: "Rechazar",
    confirmApprove: "¿Confirmas que autorizas a esta persona como prestador?",
    confirmReject: "¿Confirmas que rechazas el registro de esta persona como prestador?",
    confirmButton: "Confirmar",
    cancelButton: "Cancelar",
    cancelled: "No se hizo ningún cambio. El registro sigue pendiente.",
    approved: "Registro autorizado. La persona recibirá un aviso.",
    rejected: "Registro rechazado. La persona recibirá un aviso.",
    alreadyDecided: "Este registro ya fue decidido o no está disponible.",
    forbidden: "No tienes permiso para hacer esta acción.",
    error: "No pude completar la acción. Inténtalo de nuevo más tarde.",
    morePending: 'Hay más registros pendientes. Decide estos y vuelve a pulsar "Registros pendientes".',
  },
  // B08: autorizar administradores (D-103). Solo `confirm` y `authorized` incluyen el ID que escribió el administrador.
  adminAuth: {
    askId: "Escribe el ID de Telegram de la persona que quieres autorizar como administrador. Es un número, por ejemplo 123456789.",
    idInvalid: "Ese ID no es válido. Debe ser un número de Telegram, solo con dígitos y sin espacios. Escríbelo de nuevo.",
    confirm: (id: string) =>
      `¿Confirmas que autorizas como administrador al ID de Telegram ${id}? Esa persona podrá usar las funciones de administrador.`,
    confirmButton: "Confirmar",
    cancelButton: "Cancelar",
    authorized: (id: string) => `Autorización completada. El ID de Telegram ${id} ya es administrador.`,
    alreadyAdmin: "Ese ID ya está autorizado como administrador.",
    conflict: "Ese ID ya tiene un rol de prestador o un registro de prestador pendiente, y no puede ser administrador.",
    cancelled: "No se hizo ningún cambio. No se autorizó a nadie.",
    noDraft: "No hay ninguna autorización por confirmar.",
    error: "No pude completar la autorización. Inténtalo de nuevo más tarde.",
  },
  // B09: revocar el rol de un administrador o prestador (D-020, D-128). Solo llevan el nombre o el ID de Telegram del afectado.
  revoke: {
    button: "Revocar rol",
    listHeader: "Elige a la persona a la que quieres quitar el rol.",
    listItem: (who: string, role: "admin" | "provider", principal: boolean) =>
      `${who} (${principal ? PRINCIPAL_MARK : role === "admin" ? "administrador" : "prestador"})`,
    principalMark: PRINCIPAL_MARK,
    more: "Ver más",
    confirmAdmin: (who: string) => `¿Confirmas que quitas el rol de administrador a ${who}? Perderá el acceso de inmediato.`,
    confirmProvider: (who: string) =>
      `¿Confirmas que quitas el rol de prestador a ${who}? Perderá el acceso de inmediato; sus fichas no se borran.`,
    cancelled: "No se hizo ningún cambio. La persona conserva su rol.",
    revoked: (who: string) => `Rol revocado. ${who} ya no tiene acceso.`,
    principalProtected: "No se puede quitar el rol al administrador principal.",
    lastAdminProtected: "No se puede quitar el rol porque el sistema se quedaría sin administradores.",
    alreadyRevoked: "Ese rol ya fue revocado o no está disponible.",
  },
  // B02 y B03: revocar mi autorización (D-018, D-019, D-023, D-134). Ningún texto lleva datos personales.
  selfRevoke: {
    button: "Revocar mi autorización",
    // Frase de D-023, idéntica a `revocationNote` del aviso vigente.
    note: "El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador.",
    confirm:
      "¿Confirmas que revocas tu autorización? Se borrarán la vinculación de este chat, los datos de tu cuenta y, si tienes, tu registro como prestador con su número de identidad. Solo se conservará la prueba de que autorizaste y revocaste, sin tu número de identidad. Para volver a usar el bot tendrás que aceptar de nuevo el aviso de privacidad",
    confirmButton: "Sí, revocar",
    cancelButton: "Cancelar",
    cancelled: "No se hizo ningún cambio. Tu autorización sigue vigente",
    revoked:
      "Revocaste tu autorización. Tus datos fueron eliminados. Si quieres volver a usar el bot, envía /start y acepta de nuevo el aviso de privacidad",
    confirmProvider:
      "¿Confirmas que revocas tu autorización? Se borrarán tu número de identidad, tu registro como prestador y la vinculación de este chat, y perderás el rol de prestador. Solo se conservará la prueba de que autorizaste y revocaste, sin tu número de identidad. Para volver a usar el bot tendrás que aceptar de nuevo el aviso de privacidad",
    confirmAdmin:
      "¿Confirmas que revocas tu autorización? Perderás el rol de administrador y se borrarán la vinculación de este chat y los datos de tu cuenta. Solo se conservará la prueba de que autorizaste y revocaste, sin datos que te identifiquen. Para volver a usar el bot tendrás que aceptar de nuevo el aviso de privacidad",
    confirmProviderAdmin:
      "¿Confirmas que revocas tu autorización? Se borrarán tu número de identidad, tu registro como prestador y la vinculación de este chat, y perderás tus dos roles: el de prestador y el de administrador. Solo se conservará la prueba de que autorizaste y revocaste, sin tu número de identidad. Para volver a usar el bot tendrás que aceptar de nuevo el aviso de privacidad",
    // `detail` del 409 `principal_admin_protected` por HTTP.
    principalProtected: "Eres el administrador principal, por eso no puedes revocar tu autorización. No se borró ni se cambió nada",
    // `detail` del 409 `last_admin_protected` por HTTP.
    lastAdminProtected: "Eres el único administrador, por eso no puedes revocar tu autorización. Autoriza primero a otro administrador. No se borró ni se cambió nada",
    error: "No pude completar la revocación. Inténtalo de nuevo más tarde",
  },
  // B21: textos comunes a todos los formularios conversacionales (D-083). Ninguno incluye lo escrito por la persona.
  common: {
    nothingToCancel: "No hay nada que cancelar.",
    useButtons: "Para continuar, usa los botones del mensaje anterior. Si prefieres salir, envía /cancelar.",
    sessionConflict: "Tu mensaje anterior todavía se estaba procesando. Repite el paso, por favor.",
  },
  // B16 (F023): detalle de una ficha publicada. Etiquetas de los campos y aviso cuando las fotos no se pueden mostrar.
  listingDetail: {
    municipality: "Municipio",
    category: "Categoría",
    type: "Tipo",
    description: "Descripción",
    schedule: "Horarios",
    contact: "Contacto",
    guides: "Guías",
    photosUnavailable: "No pude mostrar las fotos de esta ficha por ahora.",
  },
  // B19 (F030): solicitud de información desde una ficha publicada. Textos aprobados en D-182, D-183 y D-184. Ninguno ofrece pagar ni
  // asegurar nada; la única aparición de la palabra "reserva" es la aclaración aprobada de que la solicitud no la es (invariante 5).
  informationRequest: {
    button: "Solicitar información",
    proposeName: (name: string) => `Usaré este nombre para tu solicitud: ${name}`,
    useName: "Usar este nombre",
    changeName: "Cambiar nombre",
    cancelButton: "Cancelar",
    askName: "Escribe el nombre que quieres usar para tu solicitud.",
    nameInvalid: "El nombre no puede estar vacío ni pasar de 4096 caracteres. Escríbelo de nuevo.",
    askDate: "¿Para qué fecha te interesa? Escríbela como DD/MM/AAAA, por ejemplo 15/12/2026.",
    dateInvalid: "No pude entender esa fecha. Escríbela como DD/MM/AAAA, por ejemplo 15/12/2026.",
    datePast: "La fecha no puede ser anterior a hoy. Escríbela como DD/MM/AAAA, por ejemplo 15/12/2026.",
    askParty: "¿Para cuántas personas es? Escribe un número entero mayor que cero.",
    partyInvalid: "El número de personas debe ser un entero mayor que cero. Escríbelo de nuevo, por ejemplo 3.",
    askMessage: "Escribe tu mensaje para el prestador. Máximo 4096 caracteres.",
    messageInvalid: "El mensaje no puede estar vacío ni pasar de 4096 caracteres. Escríbelo de nuevo.",
    summary: (d: { listing: string; name: string; date: string; partySize: number; message: string }) =>
      `Esta es tu solicitud de información:\nFicha: ${d.listing}\nNombre: ${d.name}\nFecha de interés: ${d.date}\nPersonas: ${d.partySize}\nMensaje: ${d.message}\n\n¿La envías al prestador?`,
    confirmButton: "Confirmar",
    sent: "Tu solicitud fue enviada al prestador. No es una reserva confirmada.",
    cancelled: "Solicitud cancelada.",
    alreadySent: "Esta solicitud ya fue enviada.",
    rateLimited: "Llegaste al límite de solicitudes de hoy. Intenta de nuevo mañana.",
    unavailable: "Esta ficha ya no recibe solicitudes.",
    expired: "Esa solicitud ya no está en curso. Abre la ficha y pulsa «Solicitar información» para empezar de nuevo.",
    error: "No pude enviar tu solicitud. Inténtalo de nuevo más tarde.",
  },
  // Botón de ubicación de la ficha (F021); lo usa la pantalla de detalle B16 de F023.
  location: {
    button: "Ver ubicación",
  },
  errors: {
    generic: "Ocurrió un error. Intenta de nuevo en unos minutos.",
  },
} as const;
