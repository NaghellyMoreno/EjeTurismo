import { es } from "@/bot/texts/es";

// Textos de la Mini App en español (D-112, D-117). `providerOptions` repite `menu.providerAvailable` y `registrationPending`
// reutiliza `provider.pending` para que bot y Mini App digan lo mismo. Ninguno lleva número ni tipo de documento.
export const miniappTexts = {
  title: "Eje Turismo",
  providerOptions: es.menu.providerAvailable,
  adminOptions: "Eres administrador. Las opciones de administración se usan desde el bot de Telegram.",
  registerHint: "Para registrarte como prestador, escribe /start en el bot de Telegram y pulsa «Registrarme como prestador».",
  registrationPending: es.provider.pending,
  providerRevoked: "Tu rol de prestador fue revocado y ya no tienes acceso a las opciones de prestador. Si tienes dudas, comunícate con el administrador.",
  // F036 (D-141, D-142): M01 en la Mini App. Los botones y la frase de revocar se citan de `es` y no se copian.
  declined: "Sin tu autorización no podemos guardar ningún dato. Si cambias de opinión, pulsa «Volver a ver el aviso»",
  noticeError: "No pudimos mostrar el aviso de privacidad. Cierra la Mini App y ábrela de nuevo en unos minutos",
  acceptError: "No pudimos registrar tu aceptación. Inténtalo de nuevo en unos minutos",
  sessionExpired: "Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.",
  loading: "Cargando…",
  // F010 (D-129): enlace del inicio del administrador a M10 y textos de la pantalla de municipios.
  adminMunicipalitiesLink: "Administrar municipios",
} as const;

// Pantalla M10 (F010, D-129): clave `miniapp.municipalities.*` del contrato.
export const municipalityTexts = {
  title: "Municipios",
  empty: "Aún no hay municipios registrados.",
  newButton: "Nuevo municipio",
  createTitle: "Nuevo municipio",
  editTitle: "Editar municipio",
  nameLabel: "Nombre",
  departmentLabel: "Departamento",
  generalInfoLabel: "Información general",
  zoneLabel: "Zona (opcional)",
  save: "Guardar",
  confirmCreate: "¿Confirmas que quieres crear este municipio?",
  confirmUpdate: "¿Confirmas que quieres guardar los cambios de este municipio?",
  confirm: "Confirmar",
  cancel: "Cancelar",
  created: "Municipio creado.",
  updated: "Municipio actualizado.",
  duplicate: "Ya existe un municipio con ese nombre.",
  invalid: "Revisa los campos marcados.",
  error: "No pudimos completar la operación. Intenta de nuevo en unos minutos.",
  forbidden: "No tienes permiso para administrar municipios.",
} as const;

// M11 (F011): textos aprobados en D-130. Ninguno lleva identificadores de Telegram ni datos personales.
export const catalogTexts = {
  link: "Categorías y tipos",
  title: "Categorías y tipos",
  categories: "Categorías",
  experienceTypes: "Tipos de experiencia",
  establishmentTypes: "Tipos de establecimiento",
  nameLabel: "Nombre",
  save: "Guardar",
  confirmCreate: (name: string) => `Vas a crear «${name}». ¿Confirmas?`,
  confirmEdit: (name: string) => `Vas a cambiar el nombre a «${name}». El cambio se verá en las fichas que lo usan. ¿Confirmas?`,
  confirm: "Confirmar",
  cancel: "Cancelar",
  nameRequired: "Escribe un nombre.",
  duplicate: "Ya existe un elemento con ese nombre.",
  forbidden: "No tienes permiso para administrar estas listas.",
  genericError: "No pudimos guardar el cambio. Inténtalo de nuevo.",
} as const;

// M09 (F012): formulario del atractivo del administrador. Textos aprobados en D-147; el texto de los errores de campo
// que devuelve el servidor es el de `errors[].message` (los de cliente repiten los de `error.<campo>.required`).
export const attractionTexts = {
  link: "Registrar atractivo",
  title: "Registrar atractivo",
  nameLabel: "Nombre",
  municipalityLabel: "Municipio",
  categoryLabel: "Categoría",
  selectPlaceholder: "Elige una opción",
  descriptionLabel: "Descripción",
  scheduleLabel: "Horarios",
  contactLabel: "Contacto",
  mapsUrlLabel: "Enlace de Google Maps",
  save: "Guardar",
  confirmCreate: (name: string) => `Vas a publicar «${name}». Será visible para los visitantes de inmediato, sin revisión. ¿Confirmas?`,
  confirm: "Confirmar",
  cancel: "Cancelar",
  created: "Atractivo registrado y publicado.",
  duplicate: "Ya existe un atractivo con ese nombre en ese municipio.",
  invalid: "Revisa los campos marcados.",
  genericError: "No pudimos registrar el atractivo. Inténtalo de nuevo en unos minutos.",
  forbidden: "No tienes permiso para registrar atractivos.",
  listsError: "No pudimos cargar las listas. Inténtalo de nuevo.",
  required: {
    name: "El nombre es obligatorio.",
    municipalityId: "Elige un municipio.",
    categoryId: "Elige una categoría.",
    description: "La descripción es obligatoria.",
    schedule: "Los horarios son obligatorios.",
    contact: "El contacto es obligatorio.",
    mapsUrl: "El enlace de Google Maps es obligatorio.",
  },
} as const;
