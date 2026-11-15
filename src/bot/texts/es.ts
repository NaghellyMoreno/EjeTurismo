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
  },
  errors: {
    generic: "Ocurrió un error. Intenta de nuevo en unos minutos.",
  },
} as const;
