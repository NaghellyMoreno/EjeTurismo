import { z } from "zod";
import type { FieldError } from "@/server/errors";
import { isGoogleMapsUrl } from "./maps-url";

// Límites de caracteres de D-042.
export const LISTING_LIMITS = { name: 100, description: 1500, schedule: 300, contact: 200 } as const;
export const LISTING_KINDS = ["attraction", "establishment", "route_experience"] as const;
export type ListingKindValue = (typeof LISTING_KINDS)[number];

export const CONFIRMATION_REQUIRED_TEXT = "Debes confirmar la operación para continuar.";

// Mensajes de `errors[].message` (D-147). Clave `<campo>.<código>`; los de ID y parámetros se resuelven en `listingErrorMessage`.
const MESSAGES: Record<string, string> = {
  "name.required": "El nombre es obligatorio.",
  "municipalityId.required": "Elige un municipio.",
  "categoryId.required": "Elige una categoría.",
  "description.required": "La descripción es obligatoria.",
  "schedule.required": "Los horarios son obligatorios.",
  "contact.required": "El contacto es obligatorio.",
  "mapsUrl.required": "El enlace de Google Maps es obligatorio.",
  "name.too_long": "El nombre admite hasta 100 caracteres.",
  "description.too_long": "La descripción admite hasta 1500 caracteres.",
  "schedule.too_long": "Los horarios admiten hasta 300 caracteres.",
  "contact.too_long": "El contacto admite hasta 200 caracteres.",
  "mapsUrl.invalid_maps_url": "Escribe un enlace de Google Maps (por ejemplo, maps.app.goo.gl o google.com/maps).",
  "municipalityId.invalid": "El municipio elegido no es válido.",
  "categoryId.invalid": "La categoría elegida no es válida.",
  "municipalityId.not_found": "El municipio elegido ya no existe. Actualiza la pantalla.",
  "categoryId.not_found": "La categoría elegida ya no existe. Actualiza la pantalla.",
  "confirmed.confirmation_required": CONFIRMATION_REQUIRED_TEXT,
  "kind.required": "El tipo de ficha es obligatorio.",
  "kind.invalid": "El tipo de ficha no es válido.",
  "content.required": "Faltan los datos del atractivo.",
  "body.invalid_json": "La solicitud no tiene un formato válido.",
};
export const LISTING_ERROR_MESSAGES: Readonly<Record<string, string>> = MESSAGES;

export const PARAM_INVALID_TEXT = "El valor indicado no es válido.";

export function listingErrorMessage(field: string, code: string): string {
  if (code === "not_allowed") return "Este dato no corresponde a un atractivo.";
  if (code === "unknown_field") return "Este dato no se reconoce.";
  return MESSAGES[`${field}.${code}`] ?? PARAM_INVALID_TEXT;
}

const fieldError = (field: string, code: string): FieldError => ({ field, code, message: listingErrorMessage(field, code) });

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export interface AttractionContent {
  name: string;
  municipalityId: string;
  categoryId: string;
  description: string;
  schedule: string;
  contact: string;
  mapsUrl: string;
}

export type ParsedCreate =
  | { ok: true; content: AttractionContent }
  | { ok: false; errors: FieldError[] }
  | { ok: false; forbiddenKind: true };

const ROOT_KEYS = ["kind", "content", "confirmed"];
const TEXT_FIELDS = ["name", "description", "schedule", "contact", "mapsUrl"] as const;
const CONTENT_KEYS = [...TEXT_FIELDS, "municipalityId", "categoryId"];
const NOT_ALLOWED_FOR_ATTRACTION = ["establishmentTypeId", "experienceTypeId", "guidesInfo"];

// Valida el cuerpo de `createListing`. Solo el camino `attraction` del administrador (F012): otro `kind` válido devuelve
// `forbiddenKind` (403). Los textos se guardan sin los espacios de los extremos; un texto vacío o solo de espacios es `required`.
export function parseAttractionCreate(raw: unknown): ParsedCreate {
  if (!isRecord(raw)) return { ok: false, errors: [fieldError("body", "invalid_json")] };
  const errors: FieldError[] = [];

  const kind = raw.kind;
  if (kind === undefined || kind === null) errors.push(fieldError("kind", "required"));
  else if (typeof kind !== "string" || !(LISTING_KINDS as readonly string[]).includes(kind)) errors.push(fieldError("kind", "invalid"));
  else if (kind !== "attraction") return { ok: false, forbiddenKind: true };

  for (const key of Object.keys(raw)) if (!ROOT_KEYS.includes(key)) errors.push(fieldError(key, "unknown_field"));

  const content = raw.content;
  const values: Partial<AttractionContent> = {};
  if (content === undefined || content === null) errors.push(fieldError("content", "required"));
  else if (!isRecord(content)) errors.push(fieldError("content", "invalid"));
  else {
    for (const key of Object.keys(content)) {
      if (NOT_ALLOWED_FOR_ATTRACTION.includes(key)) errors.push(fieldError(key, "not_allowed"));
      else if (!CONTENT_KEYS.includes(key)) errors.push(fieldError(key, "unknown_field"));
    }
    for (const field of TEXT_FIELDS) {
      const value = content[field];
      const text = typeof value === "string" ? value.trim() : "";
      if (text === "") errors.push(fieldError(field, "required"));
      else if (field === "mapsUrl") {
        if (isGoogleMapsUrl(text)) values.mapsUrl = text;
        else errors.push(fieldError(field, "invalid_maps_url"));
      } else if ([...text].length > LISTING_LIMITS[field]) errors.push(fieldError(field, "too_long"));
      else values[field] = text;
    }
    for (const field of ["municipalityId", "categoryId"] as const) {
      const value = content[field];
      if (value === undefined || value === "") errors.push(fieldError(field, "required"));
      else if (!isUuid(value)) errors.push(fieldError(field, "invalid"));
      else values[field] = value;
    }
  }

  if (raw.confirmed !== true) errors.push(fieldError("confirmed", "confirmation_required"));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, content: values as AttractionContent };
}

export interface PublishedListQuery {
  page: number;
  pageSize: number;
  municipalityId?: string;
  categoryId?: string;
  kind?: ListingKindValue;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Parámetros de `listPublishedListings`: `page` >= 1, `pageSize` de 1 a 50, UUID en los filtros y `kind` del enum.
export function parsePublishedListQuery(params: URLSearchParams): { ok: true; query: PublishedListQuery } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const paramError = (field: string): FieldError => ({ field, code: "invalid", message: PARAM_INVALID_TEXT });
  const integer = (field: "page" | "pageSize", max: number, fallback: number): number => {
    const raw = params.get(field);
    if (raw === null) return fallback;
    const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) {
      errors.push(paramError(field));
      return fallback;
    }
    return n;
  };
  const query: PublishedListQuery = { page: integer("page", Number.MAX_SAFE_INTEGER, 1), pageSize: integer("pageSize", MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE) };
  for (const field of ["municipalityId", "categoryId"] as const) {
    const raw = params.get(field);
    if (raw === null) continue;
    if (isUuid(raw)) query[field] = raw;
    else errors.push(paramError(field));
  }
  const kind = params.get("kind");
  if (kind !== null) {
    if ((LISTING_KINDS as readonly string[]).includes(kind)) query.kind = kind as ListingKindValue;
    else errors.push(paramError("kind"));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, query };
}
