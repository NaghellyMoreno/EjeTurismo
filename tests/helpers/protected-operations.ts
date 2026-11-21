import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  acceptPrivacyNoticeHandler,
  approveListingVersionHandler,
  approveProviderRegistrationHandler,
  authorizeAdministratorHandler,
  createCatalogItemHandler,
  createInformationRequestHandler,
  createListingHandler,
  changeInformationRequestStatusHandler,
  createPhotoUploadHandler,
  getInformationRequestHandler,
  listMyBusinessInformationRequestsHandler,
  replyToInformationRequestHandler,
  getPublishedListingHandler,
  registerPhotoHandler,
  removePhotoHandler,
  getListingStatusHistoryHandler,
  getManagedListingHandler,
  getReviewHandler,
  listManagedListingsHandler,
  listPendingReviewsHandler,
  rejectListingVersionHandler,
  saveListingDraftHandler,
  submitListingForReviewHandler,
  createMunicipalityHandler,
  createProviderRegistrationHandler,
  getMeHandler,
  getMyProviderRegistrationHandler,
  listCatalogHandler,
  listMunicipalitiesHandler,
  listPublishedListingsHandler,
  listProviderRegistrationsHandler,
  listRoleGrantsHandler,
  rejectProviderRegistrationHandler,
  renameCatalogItemHandler,
  revokeMyAuthorizationHandler,
  revokeRoleHandler,
  updateMunicipalityHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { NOTICE_VERSION } from "./db";

// Matriz de F009: las operaciones de /api/v1 con x-roles distinto de public, telegram_platform y vercel_cron que ya tienen
// `route.ts`. Las funcionalidades siguientes (F012 en adelante) agregan aquí sus rutas (D-136, pendiente 5).
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
export type PositiveRole = "none" | "account" | "consented" | "admin" | "provider";

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface ProtectedOperation {
  operationId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // con parámetros reales, listo para armar la URL
  handler: (deps: Deps) => Handler;
  role: PositiveRole; // persona que debe poder usarla (según x-roles)
  body?: unknown; // cuerpo del camino positivo; sin él, la operación con cuerpo recibe uno vacío (422)
  hasBody: boolean;
  opening?: number; // código esperado de la apertura normal cuando no es 200, 201 ni 422 (F013: ficha inexistente, 403)
}

const h = (fn: (deps: Deps) => unknown) => (deps: Deps) => fn(deps) as Handler;
const ID = UNKNOWN_ID;
const catalog = (slug: string, kind: "category" | "experience_type" | "establishment_type", param: string, names: [string, string, string]) => [
  { operationId: names[0], method: "GET", path: `/api/v1/${slug}`, handler: h((d) => listCatalogHandler(d, kind)), role: "consented", hasBody: false },
  { operationId: names[1], method: "POST", path: `/api/v1/${slug}`, handler: h((d) => createCatalogItemHandler(d, kind)), role: "admin", hasBody: true },
  { operationId: names[2], method: "PATCH", path: `/api/v1/${slug}/${ID}`, handler: h((d) => renameCatalogItemHandler(d, kind, param)), role: "admin", hasBody: true },
] satisfies ProtectedOperation[];

export const PROTECTED_OPERATIONS: ProtectedOperation[] = [
  { operationId: "getMe", method: "GET", path: "/api/v1/me", handler: h(getMeHandler), role: "none", hasBody: false },
  { operationId: "acceptPrivacyNotice", method: "POST", path: "/api/v1/consents", handler: h(acceptPrivacyNoticeHandler), role: "none", hasBody: true, body: { noticeVersion: NOTICE_VERSION, accepted: true } },
  { operationId: "revokeMyAuthorization", method: "POST", path: "/api/v1/consents/revocations", handler: h(revokeMyAuthorizationHandler), role: "account", hasBody: true, body: { confirmed: true } },
  { operationId: "createProviderRegistration", method: "POST", path: "/api/v1/provider-registrations", handler: h(createProviderRegistrationHandler), role: "consented", hasBody: true },
  { operationId: "listProviderRegistrations", method: "GET", path: "/api/v1/provider-registrations", handler: h(listProviderRegistrationsHandler), role: "admin", hasBody: false },
  { operationId: "getMyProviderRegistration", method: "GET", path: "/api/v1/provider-registrations/me", handler: h(getMyProviderRegistrationHandler), role: "consented", hasBody: false },
  { operationId: "approveProviderRegistration", method: "POST", path: `/api/v1/provider-registrations/${ID}/approval`, handler: h(approveProviderRegistrationHandler), role: "admin", hasBody: true },
  { operationId: "rejectProviderRegistration", method: "POST", path: `/api/v1/provider-registrations/${ID}/rejection`, handler: h(rejectProviderRegistrationHandler), role: "admin", hasBody: true },
  { operationId: "listRoleGrants", method: "GET", path: "/api/v1/role-grants", handler: h(listRoleGrantsHandler), role: "admin", hasBody: false },
  { operationId: "authorizeAdministrator", method: "POST", path: "/api/v1/role-grants", handler: h(authorizeAdministratorHandler), role: "admin", hasBody: true },
  { operationId: "revokeRole", method: "POST", path: `/api/v1/role-grants/${ID}/revocation`, handler: h(revokeRoleHandler), role: "admin", hasBody: true },
  { operationId: "listMunicipalities", method: "GET", path: "/api/v1/municipalities", handler: h(listMunicipalitiesHandler), role: "consented", hasBody: false },
  { operationId: "createMunicipality", method: "POST", path: "/api/v1/municipalities", handler: h(createMunicipalityHandler), role: "admin", hasBody: true },
  { operationId: "updateMunicipality", method: "PATCH", path: `/api/v1/municipalities/${ID}`, handler: h(updateMunicipalityHandler), role: "admin", hasBody: true },
  ...catalog("categories", "category", "categoryId", ["listCategories", "createCategory", "updateCategory"]),
  ...catalog("experience-types", "experience_type", "experienceTypeId", ["listExperienceTypes", "createExperienceType", "updateExperienceType"]),
  ...catalog("establishment-types", "establishment_type", "establishmentTypeId", ["listEstablishmentTypes", "createEstablishmentType", "updateEstablishmentType"]),
  { operationId: "createListing", method: "POST", path: "/api/v1/managed-listings", handler: h(createListingHandler), role: "admin", hasBody: true },
  { operationId: "listManagedListings", method: "GET", path: "/api/v1/managed-listings", handler: h(listManagedListingsHandler), role: "admin", hasBody: false },
  { operationId: "getManagedListing", method: "GET", path: `/api/v1/managed-listings/${ID}`, handler: h(getManagedListingHandler), role: "provider", hasBody: false, opening: 403 },
  { operationId: "saveListingDraft", method: "PUT", path: `/api/v1/managed-listings/${ID}/draft`, handler: h(saveListingDraftHandler), role: "provider", hasBody: true, opening: 403 },
  { operationId: "submitListingForReview", method: "POST", path: `/api/v1/managed-listings/${ID}/submission`, handler: h(submitListingForReviewHandler), role: "provider", hasBody: true, opening: 403 },
  // F014: las 4 operaciones de revisión (solo administrador). Con un ID inexistente la apertura normal es 404.
  { operationId: "listPendingReviews", method: "GET", path: "/api/v1/reviews", handler: h(listPendingReviewsHandler), role: "admin", hasBody: false },
  { operationId: "getReview", method: "GET", path: `/api/v1/reviews/${ID}`, handler: h(getReviewHandler), role: "admin", hasBody: false, opening: 404 },
  { operationId: "approveListingVersion", method: "POST", path: `/api/v1/reviews/${ID}/approval`, handler: h(approveListingVersionHandler), role: "admin", hasBody: true, opening: 404 },
  { operationId: "rejectListingVersion", method: "POST", path: `/api/v1/reviews/${ID}/rejection`, handler: h(rejectListingVersionHandler), role: "admin", hasBody: true, opening: 404 },
  // F029: historial de estados de una ficha (solo administrador). Con un ID inexistente la apertura normal es 404.
  { operationId: "getListingStatusHistory", method: "GET", path: `/api/v1/managed-listings/${ID}/status-history`, handler: h(getListingStatusHistoryHandler), role: "admin", hasBody: false, opening: 404 },
  // F020: las 3 operaciones de fotos (prestador y administrador; apertura normal 403 con una ficha inexistente) y el detalle público (404).
  { operationId: "createPhotoUpload", method: "POST", path: `/api/v1/managed-listings/${ID}/versions/${ID}/photo-uploads`, handler: h(createPhotoUploadHandler), role: "provider", hasBody: true, opening: 403 },
  { operationId: "registerPhoto", method: "POST", path: `/api/v1/managed-listings/${ID}/versions/${ID}/photos`, handler: h(registerPhotoHandler), role: "provider", hasBody: true, opening: 403 },
  { operationId: "removePhoto", method: "DELETE", path: `/api/v1/managed-listings/${ID}/versions/${ID}/photos/${ID}`, handler: h(removePhotoHandler), role: "provider", hasBody: false, opening: 403 },
  { operationId: "getPublishedListing", method: "GET", path: `/api/v1/public/listings/${ID}`, handler: h(getPublishedListingHandler), role: "consented", hasBody: false, opening: 404 },
  { operationId: "listPublishedListings", method: "GET", path: "/api/v1/public/listings", handler: h(listPublishedListingsHandler), role: "consented", hasBody: false },
  // F030: enviar una solicitud de información (cualquier cuenta con el aviso vigente). Con un cuerpo vacío la apertura normal es 422.
  { operationId: "createInformationRequest", method: "POST", path: `/api/v1/public/listings/${ID}/information-requests`, handler: h(createInformationRequestHandler), role: "consented", hasBody: true },
  // F032: las 4 operaciones de solicitudes del prestador. Con un ID inexistente la apertura normal es 403 (no se revela si existe).
  { operationId: "listMyBusinessInformationRequests", method: "GET", path: "/api/v1/information-requests", handler: h(listMyBusinessInformationRequestsHandler), role: "provider", hasBody: false },
  { operationId: "getInformationRequest", method: "GET", path: `/api/v1/information-requests/${ID}`, handler: h(getInformationRequestHandler), role: "provider", hasBody: false, opening: 403 },
  { operationId: "replyToInformationRequest", method: "POST", path: `/api/v1/information-requests/${ID}/replies`, handler: h(replyToInformationRequestHandler), role: "provider", hasBody: true, opening: 403 },
  { operationId: "changeInformationRequestStatus", method: "POST", path: `/api/v1/information-requests/${ID}/status-changes`, handler: h(changeInformationRequestStatusHandler), role: "provider", hasBody: true, opening: 403 },
];

// Los 38 operationId: los 23 de F009 (criterio 1), `createListing` y `listPublishedListings` de F012 (criterio 17, D-136), las 4 de F013 (criterio 28) las 4 de F014 (criterio 15), la de F029 (criterio 17) y las 4 de F020 (criterio 20).
export const EXPECTED_OPERATION_IDS = [
  "getMe", "acceptPrivacyNotice", "revokeMyAuthorization", "createProviderRegistration", "listProviderRegistrations",
  "getMyProviderRegistration", "approveProviderRegistration", "rejectProviderRegistration", "listRoleGrants",
  "authorizeAdministrator", "revokeRole", "listMunicipalities", "createMunicipality", "updateMunicipality",
  "listCategories", "createCategory", "updateCategory", "listExperienceTypes", "createExperienceType", "updateExperienceType",
  "listEstablishmentTypes", "createEstablishmentType", "updateEstablishmentType", "createListing", "listPublishedListings",
  "listManagedListings", "getManagedListing", "saveListingDraft", "submitListingForReview",
  "listPendingReviews", "getReview", "approveListingVersion", "rejectListingVersion", "getListingStatusHistory",
  "createPhotoUpload", "registerPhoto", "removePhoto", "getPublishedListing",
];
EXPECTED_OPERATION_IDS.push("createInformationRequest"); // F030
EXPECTED_OPERATION_IDS.push("listMyBusinessInformationRequests", "getInformationRequest", "replyToInformationRequest", "changeInformationRequestStatus"); // F032

// Parámetros de ruta de cualquier operación (los manejadores leen solo el suyo).
export const routeContext = () => ({
  params: Promise.resolve({
    registrationId: ID, grantId: ID, municipalityId: ID, categoryId: ID, experienceTypeId: ID, establishmentTypeId: ID, listingId: ID, versionId: ID, photoId: ID, requestId: ID,
  }),
});

export function buildRequest(op: ProtectedOperation, headers: Record<string, string>, body: unknown = op.hasBody ? {} : undefined): Request {
  return new Request(`http://localhost${op.path}`, {
    method: op.method,
    headers: { ...(op.hasBody ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(op.hasBody ? { body: JSON.stringify(body) } : {}),
  });
}

// ---- openapi ----------------------------------------------------------------------------------------------------
interface SpecOperation { operationId: string; "x-roles"?: string[]; responses: Record<string, { $ref?: string; content?: Record<string, { schema?: { $ref?: string; items?: { $ref?: string } } }> }> }
interface Spec { paths: Record<string, Record<string, SpecOperation>>; components: { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string; items?: { $ref?: string } } }> }> } }
export const spec = parse(readFileSync(resolve(process.cwd(), "api/openapi.yaml"), "utf8")) as Spec;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
export const specOperations = Object.entries(spec.paths).flatMap(([path, item]) =>
  HTTP_METHODS.filter((m) => item[m]).map((m) => ({ path, method: m.toUpperCase(), operationId: item[m].operationId, roles: item[m]["x-roles"] ?? [] })),
);

// Esquema de componentes de la respuesta `status` de una operación; `array` si el cuerpo es una lista de ese esquema.
export function responseSchemaName(operationId: string, status: number): { name: string; array: boolean } | null {
  const op = Object.values(spec.paths).flatMap((i) => Object.values(i)).find((o) => o.operationId === operationId);
  const response = op && op.responses[String(status)];
  if (!response) return null;
  const resolved = response.$ref ? spec.components.responses[response.$ref.split("/").pop()!] : response;
  const schema = Object.values(resolved?.content ?? {})[0]?.schema;
  const ref = schema?.$ref ?? schema?.items?.$ref;
  return ref ? { name: ref.split("/").pop()!, array: !schema?.$ref } : null;
}
