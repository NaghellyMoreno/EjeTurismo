import type { components } from "@/shared/api/schema";
import { es } from "@/bot/texts/es";
import { miniappTexts } from "./texts";

type Me = components["schemas"]["Me"];

export const homeTitle = miniappTexts.title;

export type HomeView = "role-admin" | "role-provider" | "registration-pending" | "role-revoked" | "register-hint";

// M02: decide solo con lo que informa `getMe` (HU-006 criterio 4; sección 3.16); nada de rol viene del cliente.
// Solo se llama con el aviso vigente aceptado (si falta, la pantalla muestra M01, F036); el administrador prevalece sobre el prestador (D-116).
export function homeView(me: Me): HomeView {
  if (me.roles.includes("admin")) return "role-admin";
  if (me.roles.includes("provider")) return "role-provider";
  if (me.providerRegistrationStatus === "pending") return "registration-pending";
  // Sin roles y con el registro aprobado solo se llega por una revocación (D-125): `register-hint` pediría un botón que no existe.
  if (me.providerRegistrationStatus === "approved") return "role-revoked";
  return "register-hint";
}

export const homeViewText: Record<HomeView, string> = {
  "role-admin": miniappTexts.adminOptions,
  "role-provider": miniappTexts.providerOptions,
  "registration-pending": miniappTexts.registrationPending,
  "role-revoked": miniappTexts.providerRevoked,
  "register-hint": miniappTexts.registerHint,
};

// M03: la confirmación dice qué se pierde según los roles de `getMe`; con una versión anterior del aviso no informa roles y
// se usa el texto común (F036, P4). La regla de quién puede revocar sigue siendo del backend.
export function revokeConfirmText(me: Me): string {
  const provider = me.roles.includes("provider");
  const admin = me.roles.includes("admin");
  if (provider && admin) return es.selfRevoke.confirmProviderAdmin;
  if (admin) return es.selfRevoke.confirmAdmin;
  if (provider) return es.selfRevoke.confirmProvider;
  return es.selfRevoke.confirm;
}

// Motivo del 409 de la revocación: el mismo texto del `detail` del servidor (F035).
export const protectedText = (code: string | undefined): string | null =>
  code === "principal_admin_protected" ? es.selfRevoke.principalProtected : code === "last_admin_protected" ? es.selfRevoke.lastAdminProtected : null;
