import type { FieldError } from "@/server/errors";
import { clip, TELEGRAM_TEXT_LIMIT } from "./information-request-alert";

// F032: reglas de la respuesta del prestador (D-010) y del cambio de estado (D-044). Las usan la API y el bot, para que ambos validen igual.
export const REPLY_MAX_LENGTH = 4096;

const codePoints = (text: string) => [...text].length;

export const checkReplyBody = (body: string): "required" | "too_long" | null =>
  body.trim() === "" ? "required" : codePoints(body) > REPLY_MAX_LENGTH ? "too_long" : null;

// Valida un cuerpo de la API. Los errores nunca repiten lo enviado (sección 3.15); un campo desconocido tampoco se nombra.
function checkBody(raw: unknown, known: Set<string>): { errors: FieldError[]; body: Record<string, unknown> } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: [{ field: "body", code: "invalid_format", message: "Revisa los datos enviados." }], body: {} };
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  if (Object.keys(body).some((key) => !known.has(key))) errors.push({ field: "body", code: "invalid_format", message: "Hay campos que no se admiten." });
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });
  return { errors, body };
}

export function validateReplyCreate(raw: unknown): { errors: FieldError[]; value?: { body: string } } {
  const { errors, body } = checkBody(raw, new Set(["body", "confirmed"]));
  const text = body.body;
  const result = typeof text === "string" ? checkReplyBody(text) : "required";
  if (result === "required") errors.push({ field: "body", code: "required", message: "La respuesta es obligatoria." });
  else if (result === "too_long") errors.push({ field: "body", code: "too_long", message: "La respuesta admite hasta 4096 caracteres." });
  return errors.length > 0 ? { errors } : { errors, value: { body: (text as string).trim() } };
}

export function validateStatusChange(raw: unknown): { errors: FieldError[]; value?: { status: "attended" | "closed" } } {
  const { errors, body } = checkBody(raw, new Set(["status", "confirmed"]));
  if (body.status !== "attended" && body.status !== "closed") errors.push({ field: "status", code: "invalid", message: "El estado indicado no es válido." });
  return errors.length > 0 ? { errors } : { errors, value: { status: body.status as "attended" | "closed" } };
}

// B20 (F032): texto plano al visitante, sin botones ni datos de contacto del prestador (D-189). Si pasa de 4096 se recorta la
// respuesta terminada en "…"; la ficha se conserva.
export function renderInformationRequestReply(listingName: string, reply: string): string {
  const compose = (text: string) => `Respuesta a tu solicitud de información\nFicha: ${listingName}\nMensaje del prestador: ${text}`;
  const full = compose(reply);
  if (full.length <= TELEGRAM_TEXT_LIMIT) return full;
  return compose(clip(reply, TELEGRAM_TEXT_LIMIT - compose("").length));
}
