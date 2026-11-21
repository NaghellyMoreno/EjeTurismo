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

// M04, M05, M07 y M08 (F013): ficha de establecimiento del prestador. Textos de la tabla "Textos nuevos" del contrato F013
// (clave `miniapp.listing.*`); las etiquetas y los mensajes de campo repiten los ya aprobados de F012 (D-147).
export const listingTexts = {
  homeLink: "Mis fichas",
  list: {
    title: "Mis fichas",
    empty: "Todavía no tienes fichas.",
    new: "Nueva ficha",
  },
  status: {
    draft: "Borrador",
    pending: "Pendiente de revisión",
    published: "Publicada",
    rejected: "Rechazada",
  },
  form: {
    titleNew: "Nueva ficha de establecimiento",
    titleNewRoute: "Nueva ficha de ruta o experiencia",
    titleEdit: "Editar ficha",
    kindLegend: "¿Qué vas a registrar?",
    kindEstablishment: "Establecimiento",
    kindRoute: "Ruta o experiencia",
    experienceTypeLabel: "Tipo de experiencia",
    experienceTypePlaceholder: "Elige un tipo de experiencia",
    guidesInfoLabel: "Datos del guía (opcional)",
    guidesInfoHint: "Escribe el nombre y el contacto del guía, si lo hay.",
    nameLabel: attractionTexts.nameLabel,
    municipalityLabel: attractionTexts.municipalityLabel,
    categoryLabel: attractionTexts.categoryLabel,
    establishmentTypeLabel: "Tipo de establecimiento (opcional)",
    noType: "Sin tipo",
    descriptionLabel: attractionTexts.descriptionLabel,
    scheduleLabel: attractionTexts.scheduleLabel,
    contactLabel: attractionTexts.contactLabel,
    mapsUrlLabel: attractionTexts.mapsUrlLabel,
    selectPlaceholder: attractionTexts.selectPlaceholder,
    saveDraft: "Guardar borrador",
    submit: "Enviar a revisión",
    cancel: "Cancelar",
    confirm: attractionTexts.confirm,
  },
  confirmSave: (name: string) => `Vas a guardar «${name}» como borrador. No será visible para los visitantes. ¿Confirmas?`,
  saved: "Borrador guardado.",
  declaration: "Declaro que tengo la autorización de los guías y contactos cuyos datos incluyo en esta ficha.",
  confirmSubmit: (name: string) => `Vas a enviar «${name}» a revisión. Mientras esté pendiente no podrás editarla. ¿Confirmas?`,
  submitted: "Ficha enviada a revisión. El administrador la revisará.",
  locked: "Esta ficha está pendiente de revisión y no se puede editar hasta que el administrador decida.",
  detail: {
    title: "Detalle de la ficha",
    workingVersion: "Versión de trabajo",
    notPublished: "Todavía no está publicada.",
    edit: "Editar borrador",
    back: "Volver a mis fichas",
  },
  forbidden: "No tienes permiso para gestionar fichas.",
  listError: "No pudimos cargar tus fichas. Inténtalo de nuevo.",
  genericError: "No pudimos guardar la ficha. Inténtalo de nuevo en unos minutos.",
  submitGenericError: "No pudimos enviar la ficha a revisión. Inténtalo de nuevo en unos minutos.",
  duplicate: "Ya existe una ficha con ese nombre en ese municipio.",
  invalid: attractionTexts.invalid,
  listsError: attractionTexts.listsError,
  required: { ...attractionTexts.required, experienceTypeId: "Elige un tipo de experiencia." },
  declarationRequired: "Debes declarar que tienes la autorización de los guías y contactos.",
} as const;

// M08 (F014): ficha rechazada y pendiente. Textos de la tabla "Textos nuevos" del contrato F014 (`detail.*`); `detail.edit` es el de F013.
export const listingReviewTexts = {
  rejectionReason: "Motivo del rechazo",
  correct: "Corregir y reenviar",
  pendingNote: "Tu ficha está pendiente de revisión.",
  rejectedNote: "El administrador rechazó esta ficha. Corrige lo señalado y envíala de nuevo.",
} as const;

// M08 (F015, D-154): edición de una ficha ya publicada. Textos de la tabla "Textos nuevos" del contrato F015 (`detail.*`).
export const listingEditTexts = {
  editPublished: "Editar ficha",
  stillVisible: "Los visitantes siguen viendo la versión publicada hasta que el administrador apruebe tu cambio.",
  rejectedEditNote: "El administrador rechazó tu último cambio. Se conserva la versión publicada. Corrígelo y envíalo de nuevo.",
} as const;
