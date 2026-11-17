import { es } from "@/bot/texts/es";

// Textos de la Mini App en español (D-112, D-117). `providerOptions` repite `menu.providerAvailable` y `registrationPending`
// reutiliza `provider.pending` para que bot y Mini App digan lo mismo. Ninguno lleva número ni tipo de documento.
export const miniappTexts = {
  title: "Eje Turismo",
  providerOptions: es.menu.providerAvailable,
  adminOptions: "Eres administrador. Las opciones de administración se usan desde el bot de Telegram.",
  registerHint: "Para registrarte como prestador, escribe /start en el bot de Telegram y pulsa «Registrarme como prestador».",
  registrationPending: es.provider.pending,
  consentRequired: "Para continuar, acepta el aviso de privacidad desde el bot de Telegram escribiendo /start.",
  sessionExpired: "Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.",
  loading: "Cargando…",
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
