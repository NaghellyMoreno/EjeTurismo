// Textos del bot en español. Cada texto aprobado se copia sin cambios de redacción (D-067, D-071).
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
    // B02, menú mínimo sin opciones de rol (D-068, D-071).
    welcome: "Te damos la bienvenida a Eje Turismo.\n\nComandos disponibles:\n/start: mostrar este menú",
  },
  errors: {
    generic: "Ocurrió un error. Intenta de nuevo en unos minutos.",
  },
} as const;
