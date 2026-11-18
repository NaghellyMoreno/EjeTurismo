import type { FieldError } from "@/server/errors";
import { CONFIRMATION_REQUIRED_TEXT } from "./listings";

// Cuerpos de `approveListingVersion` y `rejectListingVersion` (F014). Todos los errores se reúnen juntos en `errors[]`.
export const REJECTION_REASON_MAX = 4096;

export const REVIEW_ERROR_MESSAGES = {
  reasonRequired: "El motivo del rechazo es obligatorio.",
  reasonTooLong: "El motivo del rechazo no puede pasar de 4096 caracteres.",
  unknownField: "Este dato no se reconoce.",
  invalidJson: "La solicitud no tiene un formato válido.",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

function parse(raw: unknown, withReason: boolean): Parsed<{ reason: string | null }> {
  if (!isRecord(raw)) return { ok: false, errors: [{ field: "body", code: "invalid_json", message: REVIEW_ERROR_MESSAGES.invalidJson }] };
  const errors: FieldError[] = [];
  const allowed = withReason ? ["confirmed", "reason"] : ["confirmed"];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) errors.push({ field: key, code: "unknown_field", message: REVIEW_ERROR_MESSAGES.unknownField });
  }
  let reason: string | null = null;
  if (withReason) {
    const text = typeof raw.reason === "string" ? raw.reason.trim() : "";
    if (text === "") errors.push({ field: "reason", code: "required", message: REVIEW_ERROR_MESSAGES.reasonRequired });
    else if ([...text].length > REJECTION_REASON_MAX) errors.push({ field: "reason", code: "too_long", message: REVIEW_ERROR_MESSAGES.reasonTooLong });
    else reason = text;
  }
  if (raw.confirmed !== true) errors.push({ field: "confirmed", code: "confirmation_required", message: CONFIRMATION_REQUIRED_TEXT });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { reason } };
}

export const parseApproval = (raw: unknown) => parse(raw, false);
export const parseRejection = (raw: unknown): Parsed<{ reason: string }> => {
  const parsed = parse(raw, true);
  return parsed.ok ? { ok: true, value: { reason: parsed.value.reason! } } : parsed;
};

// Un motivo escrito en el bot: mismas reglas que el servidor (1 a 4096 caracteres sin los espacios de los extremos).
export const normalizeReason = (text: string | undefined): string | null => {
  const trimmed = text?.trim() ?? "";
  return trimmed !== "" && [...trimmed].length <= REJECTION_REASON_MAX ? trimmed : null;
};
