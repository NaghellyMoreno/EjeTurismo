import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { FieldError } from "@/server/errors";

// Número de identidad del prestador (ADR 0005, 0015; D-046, D-054, D-055). Nunca se registra en logs.
export const IDENTITY_DOCUMENT_TYPES = ["CC", "CE", "PPT", "PA"] as const;
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];

// Nombre visible de cada tipo, sin la sigla (D-046).
export const IDENTITY_DOCUMENT_NAMES: Record<IdentityDocumentType, string> = {
  CC: "cédula de ciudadanía",
  CE: "cédula de extranjería",
  PPT: "Permiso por Protección Temporal",
  PA: "pasaporte",
};

// Máximo técnico (un mensaje de Telegram), no una regla del producto (D-055).
export const IDENTITY_NUMBER_MAX_LENGTH = 4096;

export const isIdentityDocumentType = (value: unknown): value is IdentityDocumentType =>
  typeof value === "string" && (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(value);

// Solo el bot acepta la sigla sin distinguir mayúsculas (D-055); la API exige el código exacto.
export function parseTypeInsensitive(text: string): IdentityDocumentType | null {
  const upper = text.trim().toUpperCase();
  return isIdentityDocumentType(upper) ? upper : null;
}

// Tal como lo escribió la persona, sin espacios al inicio ni al final. Es lo que se cifra.
export const trimIdentityNumber = (number: string): string => number.trim();

// Para comparar duplicados: además, letras en mayúsculas. No quita puntos ni espacios internos (D-055).
export const normalizeIdentityNumber = (number: string): string => trimIdentityNumber(number).toUpperCase();

const CONTROL_CHARACTER = /\p{Cc}/u;

// Errores por campo; lista vacía si el tipo y el número sirven.
export function validateIdentityNumber(documentType: unknown, number: unknown): FieldError[] {
  const errors: FieldError[] = [];
  if (!isIdentityDocumentType(documentType)) {
    errors.push({ field: "identityDocumentType", code: "not_in_list", message: "Elige uno de los tipos de documento permitidos." });
  }
  if (number === undefined || number === null || (typeof number === "string" && number.trim() === "")) {
    errors.push({ field: "identityNumber", code: "required", message: "Escribe el número de identidad." });
  } else if (typeof number !== "string") {
    errors.push({ field: "identityNumber", code: "invalid_format", message: "El número de identidad debe ser texto." });
  } else if (number.length > IDENTITY_NUMBER_MAX_LENGTH) {
    errors.push({ field: "identityNumber", code: "too_long", message: "El número de identidad es demasiado largo." });
  } else if (CONTROL_CHARACTER.test(number)) {
    errors.push({ field: "identityNumber", code: "invalid_format", message: "El número de identidad tiene caracteres no permitidos." });
  }
  return errors;
}

// HMAC-SHA256(IDENTITY_HASH_KEY, tipo + ":" + número normalizado). Única función que arma el hash (ADR 0005).
export function identityHash(hashKey: Buffer, documentType: IdentityDocumentType, number: string): Buffer {
  return createHmac("sha256", hashKey).update(`${documentType}:${normalizeIdentityNumber(number)}`).digest();
}

// Datos asociados del cifrado: la cuenta y el formulario (ADR 0015). Descifrar con otra cuenta falla.
const associatedData = (accountId: string) => Buffer.from(`${accountId}:provider_registration`);

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// AES-256-GCM con IV aleatorio: IV + etiqueta + texto cifrado.
export function encryptIdentityNumber(encryptionKey: Buffer, accountId: string, number: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(associatedData(accountId));
  const body = Buffer.concat([cipher.update(trimIdentityNumber(number), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

// Lanza un error si la clave, la cuenta o el contenido no coinciden.
export function decryptIdentityNumber(encryptionKey: Buffer, accountId: string, payload: Buffer): string {
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
  decipher.setAAD(associatedData(accountId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
}

// Número sellado para la sesión del bot (texto base64 del mismo formato).
export const sealIdentityNumber = (key: Buffer, accountId: string, number: string): string =>
  encryptIdentityNumber(key, accountId, number).toString("base64");

export const openSealedIdentity = (key: Buffer, accountId: string, sealed: string): string =>
  decryptIdentityNumber(key, accountId, Buffer.from(sealed, "base64"));
