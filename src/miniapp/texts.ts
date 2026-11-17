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
} as const;
