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
  },
  // B06, B07: revisión de registros de prestadores por el administrador (D-090, D-096).
  admin: {
    pendingButton: "Registros pendientes",
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
  // B21: textos comunes a todos los formularios conversacionales (D-083). Ninguno incluye lo escrito por la persona.
  common: {
    nothingToCancel: "No hay nada que cancelar.",
    useButtons: "Para continuar, usa los botones del mensaje anterior. Si prefieres salir, envía /cancelar.",
    sessionConflict: "Tu mensaje anterior todavía se estaba procesando. Repite el paso, por favor.",
  },
  errors: {
    generic: "Ocurrió un error. Intenta de nuevo en unos minutos.",
  },
} as const;
