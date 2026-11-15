import { AppError } from "@/server/errors";
import type { ConsentState } from "@/server/services/consent";

// Guardián de consentimiento (D-039; ADR 0005): sin la versión vigente aceptada, 403 `consent_required`.
// No lo usan leer el aviso, getMe, aceptar ni revocar. Lo usarán las operaciones de las funcionalidades siguientes.
export function assertConsented(state: ConsentState): void {
  if (!state.accepted) {
    throw new AppError("consent_required", 403, "Debes aceptar el aviso de privacidad vigente para continuar");
  }
}
