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
  // F013 (establecimientos).
  "thirdPartyAuthorizationDeclared.declaration_required": "Debes declarar que tienes la autorización de los guías y contactos.",
  "establishmentTypeId.invalid": "El tipo de establecimiento elegido no es válido.",
  "establishmentTypeId.not_found": "El tipo de establecimiento elegido ya no existe. Actualiza la pantalla.",
  // F018 (rutas y experiencias).
  "experienceTypeId.required": "Elige un tipo de experiencia.",
  "experienceTypeId.invalid": "El tipo de experiencia elegido no es válido.",
  "guidesInfo.invalid": "Los datos del guía no son válidos.",
  "guidesInfo.too_long": "Los datos del guía admiten hasta 4096 caracteres.",
};
export const LISTING_ERROR_MESSAGES: Readonly<Record<string, string>> = MESSAGES;

export const PARAM_INVALID_TEXT = "El valor indicado no es válido.";

export function listingErrorMessage(field: string, code: string, kind: ListingKindValue = "attraction"): string {
  if (code === "not_allowed") {
    if (kind === "establishment") return "Este dato no corresponde a un establecimiento.";
    return kind === "route_experience" ? "Este dato no corresponde a una ruta o experiencia." : "Este dato no corresponde a un atractivo.";
  }
  if (code === "unknown_field") return "Este dato no se reconoce.";
  return MESSAGES[`${field}.${code}`] ?? PARAM_INVALID_TEXT;
}

const fieldError = (field: string, code: string, kind: ListingKindValue = "attraction"): FieldError => ({
  field,
  code,
  message: listingErrorMessage(field, code, kind),
});

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

// ---- Establecimientos (F013) y rutas o experiencias (F018) del prestador --------------------------------------

// Máximo técnico de `guidesInfo` en api/openapi.yaml (D-013 sigue pendiente; D-169).
export const GUIDES_INFO_MAX = 4096;
export type ProviderKind = "establishment" | "route_experience";

export interface DraftContent {
  name: string;
  municipalityId: string;
  categoryId: string | null;
  establishmentTypeId: string | null;
  experienceTypeId: string | null;
  guidesInfo: string | null;
  description: string | null;
  schedule: string | null;
  contact: string | null;
  mapsUrl: string | null;
}

const OPTIONAL_TEXT_FIELDS = ["description", "schedule", "contact", "mapsUrl"] as const;
const BASE_KEYS = ["name", "municipalityId", "categoryId", ...OPTIONAL_TEXT_FIELDS];
const KEYS_BY_KIND: Record<ProviderKind, string[]> = {
  establishment: [...BASE_KEYS, "establishmentTypeId"],
  route_experience: [...BASE_KEYS, "experienceTypeId", "guidesInfo"],
};
const NOT_ALLOWED_BY_KIND: Record<ProviderKind, string[]> = {
  establishment: ["experienceTypeId", "guidesInfo"],
  route_experience: ["establishmentTypeId"],
};
const est = (field: string, code: string): FieldError => fieldError(field, code, "establishment");

// Contenido de un borrador (P6): solo `name` y `municipalityId` son obligatorios; un campo opcional vacío (`""`, solo
// espacios o `null`) se guarda como NULL (para `guidesInfo`, D-169). Reúne todos los errores en `errors`.
function parseDraftContent(content: unknown, errors: FieldError[], kind: ProviderKind): DraftContent | undefined {
  const est = (field: string, code: string): FieldError => fieldError(field, code, kind);
  if (content === undefined || content === null) {
    errors.push(est("content", "required"));
    return undefined;
  }
  if (!isRecord(content)) {
    errors.push(est("content", "invalid"));
    return undefined;
  }
  const before = errors.length;
  for (const key of Object.keys(content)) {
    if (NOT_ALLOWED_BY_KIND[kind].includes(key)) errors.push(est(key, "not_allowed"));
    else if (!KEYS_BY_KIND[kind].includes(key)) errors.push(est(key, "unknown_field"));
  }
  const value: DraftContent = { name: "", municipalityId: "", categoryId: null, establishmentTypeId: null, experienceTypeId: null, guidesInfo: null, description: null, schedule: null, contact: null, mapsUrl: null };

  const name = typeof content.name === "string" ? content.name.trim() : "";
  if (name === "") errors.push(est("name", "required"));
  else if ([...name].length > LISTING_LIMITS.name) errors.push(est("name", "too_long"));
  else value.name = name;

  const municipality = content.municipalityId;
  if (municipality === undefined || municipality === null || municipality === "") errors.push(est("municipalityId", "required"));
  else if (!isUuid(municipality)) errors.push(est("municipalityId", "invalid"));
  else value.municipalityId = municipality;

  for (const field of ["categoryId", "establishmentTypeId", "experienceTypeId"] as const) {
    const raw = content[field];
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) continue;
    if (!isUuid(raw)) errors.push(est(field, "invalid"));
    else value[field] = raw;
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const raw = content[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      errors.push(est(field, field === "mapsUrl" ? "invalid_maps_url" : "invalid"));
      continue;
    }
    const text = raw.trim();
    if (text === "") continue;
    if (field === "mapsUrl") {
      if (isGoogleMapsUrl(text)) value.mapsUrl = text;
      else errors.push(est(field, "invalid_maps_url"));
    } else if ([...text].length > LISTING_LIMITS[field]) errors.push(est(field, "too_long"));
    else value[field] = text;
  }
  const guides = content.guidesInfo;
  if (guides !== undefined && guides !== null) {
    if (typeof guides !== "string") errors.push(est("guidesInfo", "invalid"));
    else if ([...guides.trim()].length > GUIDES_INFO_MAX) errors.push(est("guidesInfo", "too_long"));
    else value.guidesInfo = guides.trim() === "" ? null : guides.trim();
  }
  return errors.length === before ? value : undefined;
}

const confirmationError = (raw: Record<string, unknown>, errors: FieldError[]) => {
  if (raw.confirmed !== true) errors.push(est("confirmed", "confirmation_required"));
};
const unknownRootKeys = (raw: Record<string, unknown>, allowed: string[], errors: FieldError[]) => {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) errors.push(est(key, "unknown_field"));
};

export type ParsedDraftCreate =
  | { ok: true; kind: ProviderKind; content: DraftContent }
  | { ok: false; errors: FieldError[] }
  | { ok: false; forbiddenKind: true };

// `createListing` del prestador con `kind: establishment` o `route_experience` (F018). `attraction` es de administrador (403).
export function parseProviderCreate(raw: unknown): ParsedDraftCreate {
  if (!isRecord(raw)) return { ok: false, errors: [est("body", "invalid_json")] };
  const errors: FieldError[] = [];
  const kind = raw.kind;
  if (kind === undefined || kind === null) errors.push(est("kind", "required"));
  else if (kind === "attraction") return { ok: false, forbiddenKind: true };
  else if (kind !== "establishment" && kind !== "route_experience") errors.push(est("kind", "invalid"));
  unknownRootKeys(raw, ["kind", "content", "confirmed"], errors);
  const providerKind: ProviderKind = kind === "route_experience" ? "route_experience" : "establishment";
  const content = parseDraftContent(raw.content, errors, providerKind);
  confirmationError(raw, errors);
  return errors.length > 0 || !content ? { ok: false, errors } : { ok: true, kind: providerKind, content };
}

// `saveListingDraft`: el cuerpo lleva `content` y `confirmed`; reemplaza el contenido completo (P6).
export function parseDraftSave(raw: unknown, kind: ProviderKind = "establishment"): { ok: true; content: DraftContent } | { ok: false; errors: FieldError[] } {
  if (!isRecord(raw)) return { ok: false, errors: [est("body", "invalid_json")] };
  const errors: FieldError[] = [];
  unknownRootKeys(raw, ["content", "confirmed"], errors);
  const content = parseDraftContent(raw.content, errors, kind);
  confirmationError(raw, errors);
  return errors.length > 0 || !content ? { ok: false, errors } : { ok: true, content };
}

// Los 5 campos de D-003 que el borrador puede tener vacíos; se exigen al enviar a revisión sobre el contenido guardado.
export const REQUIRED_TO_SUBMIT = ["categoryId", "description", "schedule", "contact", "mapsUrl"] as const;

// En rutas y experiencias también se exige el tipo de experiencia (F018); los datos del guía son opcionales (D-169).
export function missingToSubmit(
  saved: Partial<Record<(typeof REQUIRED_TO_SUBMIT)[number], string | null>> & { experienceTypeId?: string | null },
  kind: ProviderKind = "establishment",
): FieldError[] {
  const missing = REQUIRED_TO_SUBMIT.filter((field) => (saved[field] ?? "").trim() === "").map((field) => fieldError(field, "required", kind));
  if (kind === "route_experience" && !saved.experienceTypeId) missing.push(fieldError("experienceTypeId", "required", kind));
  return missing;
}

// `submitListingForReview`: confirmación y declaración de autorización de terceros (D-024).
export function parseSubmission(raw: unknown): { ok: true } | { ok: false; errors: FieldError[] } {
  if (!isRecord(raw)) return { ok: false, errors: [est("body", "invalid_json")] };
  const errors: FieldError[] = [];
  unknownRootKeys(raw, ["confirmed", "thirdPartyAuthorizationDeclared"], errors);
  if (raw.thirdPartyAuthorizationDeclared !== true) errors.push(est("thirdPartyAuthorizationDeclared", "declaration_required"));
  confirmationError(raw, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export type DisplayStatusValue = "draft" | "pending" | "published" | "rejected";
export const DISPLAY_STATUSES: readonly DisplayStatusValue[] = ["draft", "pending", "published", "rejected"];

export interface ManagedListQuery {
  page: number;
  pageSize: number;
  kind?: ListingKindValue;
  displayStatus?: DisplayStatusValue;
}

// Parámetros de `listManagedListings`: `page` >= 1, `pageSize` de 1 a 50, `kind` y `displayStatus` de sus enumeraciones.
export function parseManagedListQuery(params: URLSearchParams): { ok: true; query: ManagedListQuery } | { ok: false; errors: FieldError[] } {
  const base = parsePublishedListQuery(new URLSearchParams([...params].filter(([key]) => key === "page" || key === "pageSize" || key === "kind")));
  const errors: FieldError[] = base.ok ? [] : [...base.errors];
  const displayStatus = params.get("displayStatus");
  let status: DisplayStatusValue | undefined;
  if (displayStatus !== null) {
    if ((DISPLAY_STATUSES as readonly string[]).includes(displayStatus)) status = displayStatus as DisplayStatusValue;
    else errors.push({ field: "displayStatus", code: "invalid", message: PARAM_INVALID_TEXT });
  }
  if (errors.length > 0 || !base.ok) return { ok: false, errors };
  const { page, pageSize, kind } = base.query;
  return { ok: true, query: { page, pageSize, ...(kind ? { kind } : {}), ...(status ? { displayStatus: status } : {}) } };
}
