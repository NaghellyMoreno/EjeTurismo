import type { FieldError } from "@/server/errors";

// Reglas de la solicitud de información (HU-024; D-044). Las usan la API y el bot, para que ambos validen igual.
// Los máximos son técnicos mientras D-013 siga pendiente.
export const INFORMATION_REQUEST_LIMITS = { name: 4096, message: 4096 } as const;
export const MAX_PARTY_SIZE = 2147483647;

// Aclaración del recibo (ejemplo de `InformationRequestReceipt.notice` en api/openapi.yaml; D-182).
export const NOT_A_RESERVATION = "No es una reserva confirmada.";
export const RECEIPT_NOTICE = `Tu solicitud fue enviada al prestador. ${NOT_A_RESERVATION}`;

const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

// Hoy en America/Bogota (UTC-5, sin horario de verano) como AAAA-MM-DD.
export const bogotaToday = (now: Date): string => new Date(now.getTime() + BOGOTA_OFFSET_MS).toISOString().slice(0, 10);

const codePoints = (text: string) => [...text].length;

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// AAAA-MM-DD de la API, con fecha real del calendario; nulo si no lo es.
export function parseIsoDate(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

// DD/MM/AAAA del bot (D-182), con fecha real del calendario; devuelve AAAA-MM-DD o nulo.
export function parseBotDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return match ? toIsoDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

// AAAA-MM-DD a DD/MM/AAAA, para mostrar la fecha al visitante.
export const formatBotDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Entero mayor que cero, solo con dígitos; nulo si no lo es.
export function parsePartySize(text: string): number | null {
  const value = text.trim();
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const size = Number(value);
  return size <= MAX_PARTY_SIZE ? size : null;
}

export type NameCheck = "required" | "too_long" | null;
export const checkRequesterName = (name: string): NameCheck =>
  name.trim() === "" ? "required" : codePoints(name) > INFORMATION_REQUEST_LIMITS.name ? "too_long" : null;
export const checkMessage = (message: string): NameCheck =>
  message.trim() === "" ? "required" : codePoints(message) > INFORMATION_REQUEST_LIMITS.message ? "too_long" : null;

export interface InformationRequestInput {
  requesterName: string;
  interestDate: string;
  partySize: number;
  message: string;
}

const KNOWN_FIELDS = new Set(["requesterName", "interestDate", "partySize", "message", "confirmed"]);

// Valida el cuerpo de `createInformationRequest`. Los errores nunca repiten lo enviado (sección 3.15); un campo desconocido
// tampoco se nombra.
export function validateInformationRequest(raw: unknown, today: string): { errors: FieldError[]; value?: InformationRequestInput } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: [{ field: "body", code: "invalid_format", message: "Revisa los datos enviados." }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  if (Object.keys(body).some((key) => !KNOWN_FIELDS.has(key))) {
    errors.push({ field: "body", code: "invalid_format", message: "Hay campos que no se admiten." });
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la solicitud." });

  const textError = (field: "requesterName" | "message", label: string, check: (text: string) => NameCheck) => {
    const value = body[field];
    const result = typeof value === "string" ? check(value) : "required";
    if (typeof value !== "string" || result === "required") errors.push({ field, code: "required", message: `${label} es obligatorio.` });
    else if (result === "too_long") errors.push({ field, code: "too_long", message: `${label} admite hasta 4096 caracteres.` });
  };
  textError("requesterName", "El nombre", checkRequesterName);
  textError("message", "El mensaje", checkMessage);

  const date = typeof body.interestDate === "string" ? parseIsoDate(body.interestDate) : null;
  if (date === null) errors.push({ field: "interestDate", code: "invalid_format", message: "Escribe una fecha válida con el formato AAAA-MM-DD." });
  else if (date < today) errors.push({ field: "interestDate", code: "must_be_future", message: "La fecha no puede ser anterior a hoy." });

  const size = body.partySize;
  if (typeof size !== "number" || !Number.isInteger(size) || size > MAX_PARTY_SIZE) {
    errors.push({ field: "partySize", code: "invalid_format", message: "El número de personas debe ser un entero." });
  } else if (size < 1) {
    errors.push({ field: "partySize", code: "must_be_positive", message: "El número de personas debe ser mayor que cero." });
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    value: {
      requesterName: (body.requesterName as string).trim(),
      interestDate: date!,
      partySize: size as number,
      message: (body.message as string).trim(),
    },
  };
}
