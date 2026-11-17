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
  consentRequired: "Para continuar, acepta el aviso de privacidad desde el bot de Telegram escribiendo /start.",
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
