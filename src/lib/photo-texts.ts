// Textos de las fotografías de una ficha (F020, aprobados en D-162). Los usan el backend (campo `detail` de los errores) y la
// pantalla M06; así dicen lo mismo en los dos lados.
export const photoTexts = {
  title: "Fotos de la ficha",
  counter: (n: number) => `Fotos: ${n} de 10`,
  upload: "Agregar foto",
  formats: "Formatos permitidos: JPEG o PNG. Máximo 5 MB por foto.",
  invalidType: "El archivo no es una imagen. Elige una foto en formato JPEG o PNG.",
  tooLarge: "La foto pesa más de 5 MB. Elige una foto más liviana.",
  limitReached: "La ficha ya tiene 10 fotos. Quita una para agregar otra.",
  totalExceeded: "Las fotos de la ficha superan el espacio máximo permitido. Quita alguna para agregar otra.",
  quotaExceeded: "Por ahora no se pueden guardar más fotos. Inténtalo más tarde o avisa al administrador.",
  remove: (n: number) => `Quitar foto ${n}`,
  removeConfirm: "¿Quitar esta foto de la ficha?",
  removeYes: "Sí, quitar",
  removeNo: "No, conservar",
  removed: "La foto se quitó de la ficha.",
  uploadFailed: "No se pudo guardar la foto. Inténtalo de nuevo.",
  rateLimited: "Has intentado subir muchas fotos. Espera un rato e inténtalo de nuevo.",
  publishedNote: "Los visitantes siguen viendo las fotos publicadas hasta que el administrador apruebe tu cambio.",
  attractionNote: "Los cambios en las fotos de un atractivo se publican de inmediato.",
  alt: (n: number) => `Foto ${n} de la ficha`,
} as const;
