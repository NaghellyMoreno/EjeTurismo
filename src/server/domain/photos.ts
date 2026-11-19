import { z } from "zod";
import { photoTexts } from "@/lib/photo-texts";
import type { FieldError } from "@/server/errors";

// Reglas de las fotografías de una ficha (F020; D-031, D-042; ADR 0009).
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];
export const MAX_PHOTOS_PER_VERSION = 10;
export const MAX_BYTES_PER_VERSION = 2_147_483_648;
export const PHOTO_UPLOAD_TTL_MS = 15 * 60 * 1000;
export const PHOTO_URL_TTL_MS = 10 * 60 * 1000;
export const PHOTO_UPLOAD_ACTION = "photo_upload";

export const PHOTO_EXTENSION: Record<PhotoContentType, string> = { "image/jpeg": "jpg", "image/png": "png" };

export type ParsedPhotoUpload = { ok: true; contentType: PhotoContentType; sizeBytes: number } | { ok: false; errors: FieldError[]; detail: string };

const isContentType = (value: unknown): value is PhotoContentType => PHOTO_CONTENT_TYPES.includes(value as PhotoContentType);

// 422 de `createPhotoUpload`: tipo (JPEG o PNG) y tamaño (hasta `maxBytes`, inclusive). El `detail` es el texto de la tabla aprobada.
export function parsePhotoUpload(raw: unknown, maxBytes: number): ParsedPhotoUpload {
  const body = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: FieldError[] = [];
  let detail = "Revisa los campos marcados.";
  const { fileName, contentType, sizeBytes } = body;
  if (typeof fileName !== "string" || fileName.length < 1 || fileName.length > 255) {
    errors.push({ field: "fileName", code: typeof fileName === "string" && fileName.length > 255 ? "too_long" : "required", message: "Revisa el nombre del archivo." });
  }
  if (!isContentType(contentType)) {
    errors.push({ field: "contentType", code: "not_in_list", message: photoTexts.invalidType });
    detail = photoTexts.invalidType;
  }
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 1) {
    errors.push({ field: "sizeBytes", code: sizeBytes === undefined ? "required" : "invalid_format", message: "Revisa el tamaño de la foto." });
  } else if (sizeBytes > maxBytes) {
    errors.push({ field: "sizeBytes", code: "too_large", message: photoTexts.tooLarge });
    if (errors.length === 1) detail = photoTexts.tooLarge;
  }
  if (errors.length > 0) return { ok: false, errors, detail };
  return { ok: true, contentType: contentType as PhotoContentType, sizeBytes: sizeBytes as number };
}

const registrationSchema = z.strictObject({ uploadId: z.uuid() });

export function parsePhotoRegistration(raw: unknown): { ok: true; uploadId: string } | { ok: false; errors: FieldError[] } {
  const parsed = registrationSchema.safeParse(raw);
  if (parsed.success) return { ok: true, uploadId: parsed.data.uploadId };
  return { ok: false, errors: [{ field: "uploadId", code: "invalid_format", message: "Revisa el identificador de la subida." }] };
}

// Firma de los primeros bytes: JPEG empieza con FF D8 FF; PNG con 89 50 4E 47 0D 0A 1A 0A.
export function detectImageType(bytes: Uint8Array): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((value, index) => bytes[index] === value)) return "image/png";
  return null;
}
