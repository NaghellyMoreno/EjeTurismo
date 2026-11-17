import type { components } from "@/shared/api/schema";
import { miniappTexts } from "./texts";

type Me = components["schemas"]["Me"];

export const homeTitle = miniappTexts.title;

export type HomeView = "consent-required" | "role-admin" | "role-provider" | "registration-pending" | "role-revoked" | "register-hint";

// M02: decide solo con lo que informa `getMe` (HU-006 criterio 4; sección 3.16); nada de rol viene del cliente.
// Si falta aceptar el aviso no se muestra ningún dato de la cuenta; el administrador prevalece sobre el prestador (D-116).
export function homeView(me: Me): HomeView {
  if (me.consent.required) return "consent-required";
  if (me.roles.includes("admin")) return "role-admin";
  if (me.roles.includes("provider")) return "role-provider";
  if (me.providerRegistrationStatus === "pending") return "registration-pending";
  // Sin roles y con el registro aprobado solo se llega por una revocación (D-125): `register-hint` pediría un botón que no existe.
  if (me.providerRegistrationStatus === "approved") return "role-revoked";
  return "register-hint";
}

export const homeViewText: Record<HomeView, string> = {
  "consent-required": miniappTexts.consentRequired,
  "role-admin": miniappTexts.adminOptions,
  "role-provider": miniappTexts.providerOptions,
  "registration-pending": miniappTexts.registrationPending,
  "role-revoked": miniappTexts.providerRevoked,
  "register-hint": miniappTexts.registerHint,
};
