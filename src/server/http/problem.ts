import type { components } from "@/shared/api/schema";
import { AppError, type ErrorCode, type FieldError } from "@/server/errors";

type Problem = components["schemas"]["Problem"];

const TITLES: Partial<Record<ErrorCode, string>> = {
  unauthenticated: "No autenticado",
  forbidden: "Acceso denegado",
  consent_required: "Falta aceptar el aviso de privacidad",
  not_found: "No encontrado",
  duplicate: "Registro duplicado",
  admin_cannot_register_as_provider: "Un administrador no puede registrarse como prestador",
  rate_limited: "Demasiados intentos",
  validation_failed: "Datos inválidos",
  notice_version_outdated: "El aviso cambió",
  internal_error: "Error del sistema",
};

const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// Formato único de error (RFC 9457), en español y sin detalles internos (ADR 0006).
export function problem(status: number, code: ErrorCode, detail: string, errors?: FieldError[], headers: Record<string, string> = {}): Response {
  const body: Problem = { type: "about:blank", title: TITLES[code] ?? "Error", status, code, detail, ...(errors ? { errors } : {}) };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json", ...NO_STORE, ...headers },
  });
}

export const unauthenticated = () =>
  problem(401, "unauthenticated", "No pudimos verificar tu identidad de Telegram. Abre de nuevo la Mini App.");

export const internalError = () => problem(500, "internal_error", "Ocurrió un error. Intenta de nuevo en unos minutos.");

const PUBLIC_DETAILS: Partial<Record<ErrorCode, string>> = {
  not_found: "No hay un aviso de privacidad vigente.",
  consent_required: "Debes aceptar el aviso de privacidad vigente para continuar.",
  notice_version_outdated: "El aviso de privacidad cambió. Léelo de nuevo y acéptalo.",
  forbidden: "No tienes permiso para realizar esta acción.",
  duplicate: "Ese registro ya existe.",
  admin_cannot_register_as_provider: "Una cuenta de administrador no puede registrarse como prestador.",
  rate_limited: "Hiciste demasiados intentos. Espera un momento y vuelve a intentarlo.",
};

// Traduce un error esperado de un servicio; cualquier otro error es un 500 genérico.
export function fromError(error: unknown): Response | null {
  if (error instanceof AppError) {
    const retry = error.options.retryAfterSeconds;
    return problem(
      error.status,
      error.code,
      error.options.detail ?? PUBLIC_DETAILS[error.code] ?? "No se pudo completar la operación.",
      error.errors,
      retry ? { "Retry-After": String(retry) } : {},
    );
  }
  return null;
}
