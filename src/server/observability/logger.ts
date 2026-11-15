// Registro técnico con redacción (ADR 0005 y 0006): nunca incluye initData, textos de mensajes ni identificadores de personas.
const REDACTED_KEYS = new Set(
  [
    "initdata", "authorization", "text", "message", "data", "body", "update", "from", "chat",
    "telegramuserid", "telegram_user_id", "userid", "id", "displayname", "first_name", "last_name", "username",
    "identitynumber", "identitydocumenttype", "secret", "token", "hash",
    "reason", "rejectionreason", "rejection_reason", "callback_data", "callbackdata", "payload",
  ],
);
// Familias de claves con sufijo: identity_number, identity_number_encrypted, sealedIdentity, sealedIdentityIv... (ADR 0005).
const REDACTED_PREFIXES = ["identity_number", "identity_document_type", "sealedidentity", "identitynumber"];
const isRedacted = (key: string) => {
  const lower = key.toLowerCase();
  return REDACTED_KEYS.has(lower) || REDACTED_PREFIXES.some((p) => lower.startsWith(p));
};

export function redact(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object" && depth < 6) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, isRedacted(k) ? "[redactado]" : redact(v, depth + 1)]),
    );
  }
  return value;
}

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...(redact(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

// De un error solo se registra el nombre y el código; su mensaje puede traer valores de la base o del usuario.
export function logError(event: string, error: unknown): void {
  const e = error as { name?: unknown; code?: unknown } | null;
  log("error", event, {
    errorName: typeof e?.name === "string" ? e.name : "UnknownError",
    errorCode: typeof e?.code === "string" ? e.code : undefined,
  });
}
