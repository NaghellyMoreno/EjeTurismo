import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import { parseAuthorization, verifyInitData } from "@/server/auth/init-data";
import { scheduleDelivery, telegramSender } from "@/server/notifications";
import { logError } from "@/server/observability/logger";
import { AppError } from "@/server/errors";
import {
  acceptPrivacyNotice,
  approveProviderRegistration,
  authorizeAdministrator,
  createListing,
  createMunicipality,
  createCatalogItem,
  createProviderRegistration,
  getActiveRoles,
  getConsentState,
  getCurrentPrivacyNotice,
  getManagedListing,
  getMe,
  getMyProviderRegistration,
  listManagedListings,
  listMunicipalities,
  listPublishedListings,
  listCatalog,
  listProviderRegistrations,
  listRoleGrants,
  rejectProviderRegistration,
  revokeMyAuthorization,
  revokeRole,
  saveListingDraft,
  submitListingForReview,
  updateMunicipality,
  renameCatalogItem,
} from "@/server/services";
import type { CatalogKind, ConsentState } from "@/server/services";
import type { Deps } from "./deps";
import { fromError, internalError, json, problem, unauthenticated } from "./problem";

type PrivacyNoticeBody = components["schemas"]["PrivacyNotice"];

// Valida `Authorization: tma <initData>` sin tocar la base (ADR 0003). Devuelve el actor o la respuesta 401.
export function authenticate(request: Request, deps: Deps): Actor | Response {
  const raw = parseAuthorization(request.headers.get("authorization"));
  if (!raw) return unauthenticated();
  const config = deps.config();
  const identity = verifyInitData(raw, config.botToken, config.initDataMaxAgeSeconds, deps.now());
  return identity ?? unauthenticated();
}

async function guarded(event: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const known = fromError(error);
    if (known) return known;
    logError(event, error);
    return internalError();
  }
}

// GET /api/v1/privacy-notices/current (getCurrentPrivacyNotice): público, no guarda nada.
export function getCurrentPrivacyNoticeHandler(deps: Deps) {
  return () =>
    guarded("privacy_notice.get_failed", async () => {
      const notice = await getCurrentPrivacyNotice(deps.db());
      const body: PrivacyNoticeBody = {
        version: notice.version,
        bodyMarkdown: notice.bodyMarkdown,
        declarationText: notice.declarationText,
        ...(notice.revocationNote ? { revocationNote: notice.revocationNote } : {}),
        publishedAt: notice.publishedAt.toISOString(),
      };
      return json(body);
    });
}

// GET /api/v1/me (getMe): solo lectura.
export function getMeHandler(deps: Deps) {
  return (request: Request) =>
    guarded("me.get_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await getMe(deps.db(), actor, deps.config()));
    });
}

// Estricto: campos desconocidos se rechazan (ADR 0006). `channel` se acepta pero la API HTTP siempre registra `mini_app`.
const acceptBody = z.strictObject({
  noticeVersion: z.string().min(1),
  accepted: z.literal(true),
  channel: z.enum(["bot", "mini_app"]).optional(),
});

// POST /api/v1/consents (acceptPrivacyNotice). El 401 va antes que el 422.
export function acceptPrivacyNoticeHandler(deps: Deps) {
  return (request: Request) =>
    guarded("consent.accept_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;

      const parsed = acceptBody.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))];
        return problem(422, "validation_failed", "Revisa los campos marcados.",
          fields.map((field) => ({
            field,
            code: field === "body" ? "invalid_format" : "required",
            message: field === "accepted" ? "Debes aceptar el aviso." : "Revisa este campo.",
          })));
      }
      const me = await acceptPrivacyNotice(deps.db(), actor, { noticeVersion: parsed.data.noticeVersion, channel: "mini_app" }, deps.now(), deps.config());
      return json(me, 201);
    });
}

// Envuelve una operación que exige el aviso vigente aceptado (403 `consent_required`). F001 no lo usa en ninguna ruta:
// lo usarán las funcionalidades siguientes (se prueba sobre una ruta de ejemplo).
export function withConsentGuard(
  deps: Deps,
  handler: (actor: Actor, request: Request) => Promise<Response>,
  load: (actor: Actor) => Promise<ConsentState> = (actor) => getConsentState(deps.db(), actor.telegramUserId),
) {
  return (request: Request) =>
    guarded("consent.guard_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      assertConsented(await load(actor));
      return handler(actor, request);
    });
}

// POST /api/v1/provider-registrations (createProviderRegistration). Orden: 401, 403 `consent_required`,
// 403 `admin_cannot_register_as_provider`, 422, 429 y la inserción (409 o 201); lo aplica el servicio.
export function createProviderRegistrationHandler(deps: Deps) {
  return (request: Request) =>
    guarded("provider_registration.create_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await createProviderRegistration(deps.db(), deps.config(), actor, body, deps.now()), 201);
    });
}

// GET /api/v1/provider-registrations/me (getMyProviderRegistration): solo lectura, sin tipo ni número.
export function getMyProviderRegistrationHandler(deps: Deps) {
  return (request: Request) =>
    guarded("provider_registration.get_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await getMyProviderRegistration(deps.db(), actor));
    });
}

// Guardián de rol `provider` (ADR 0003): 401, 403 `consent_required` y 403 `forbidden`. El rol se lee de `role_grants`
// en cada operación; nunca de la sesión del bot ni de `callback_data`. F002 no lo usa en ninguna ruta de prestador.
export function withProviderGuard(deps: Deps, handler: (actor: Actor, request: Request) => Promise<Response>) {
  return (request: Request) =>
    guarded("provider.guard_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      assertConsented(await getConsentState(deps.db(), actor.telegramUserId));
      if (!(await getActiveRoles(deps.db(), actor.telegramUserId)).includes("provider")) {
        throw new AppError("forbidden", 403, "Sin rol de prestador");
      }
      return handler(actor, request);
    });
}

// GET /api/v1/provider-registrations (listProviderRegistrations): solo administradores. 401, 403 y 422 los aplica el servicio.
export function listProviderRegistrationsHandler(deps: Deps) {
  return (request: Request) =>
    guarded("provider_registration.list_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const params = new URL(request.url).searchParams;
      const query = { status: params.get("status"), page: params.get("page"), pageSize: params.get("pageSize") };
      return json(await listProviderRegistrations(deps.db(), deps.config(), actor, query));
    });
}

type RegistrationRoute = { params: Promise<{ registrationId: string }> };

// POST .../{registrationId}/approval y .../rejection. Después de responder, `after()` envía el aviso (ADR 0007).
function decisionHandler(deps: Deps, event: string, decide: typeof approveProviderRegistration) {
  return (request: Request, context: RegistrationRoute) =>
    guarded(event, async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const { registrationId } = await context.params;
      const body: unknown = await request.json().catch(() => undefined);
      const result = await decide(deps.db(), deps.config(), actor, registrationId, body, deps.now());
      scheduleDelivery(result.notificationIds, {
        db: deps.db,
        now: deps.now,
        send: deps.send ?? telegramSender(deps.config()),
      });
      return json(result.registration);
    });
}

export const approveProviderRegistrationHandler = (deps: Deps) =>
  decisionHandler(deps, "provider_registration.approve_failed", approveProviderRegistration);

export const rejectProviderRegistrationHandler = (deps: Deps) =>
  decisionHandler(deps, "provider_registration.reject_failed", rejectProviderRegistration);

// GET /api/v1/municipalities (listMunicipalities): cualquier cuenta con el aviso vigente (D-039).
export function listMunicipalitiesHandler(deps: Deps) {
  return (request: Request) =>
    guarded("municipality.list_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await listMunicipalities(deps.db(), actor));
    });
}

// POST /api/v1/municipalities (createMunicipality): solo administradores. 403, 422 y 409 los aplica el servicio.
export function createMunicipalityHandler(deps: Deps) {
  return (request: Request) =>
    guarded("municipality.create_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await createMunicipality(deps.db(), deps.config(), actor, body, deps.now()), 201);
    });
}

// PATCH /api/v1/municipalities/{municipalityId} (updateMunicipality): solo administradores.
export function updateMunicipalityHandler(deps: Deps) {
  return (request: Request, context: { params: Promise<{ municipalityId: string }> }) =>
    guarded("municipality.update_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const { municipalityId } = await context.params;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await updateMunicipality(deps.db(), deps.config(), actor, municipalityId, body, deps.now()));
    });
}

// POST /api/v1/role-grants (authorizeAdministrator). Orden (D-108): 401, 403 `consent_required`, 403 `forbidden`, 422,
// 409 `duplicate` y 409 `role_conflict`; los aplica el servicio.
export function authorizeAdministratorHandler(deps: Deps) {
  return (request: Request) =>
    guarded("role_grant.authorize_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await authorizeAdministrator(deps.db(), deps.config(), actor, body, deps.now()), 201);
    });
}

// GET /api/v1/role-grants (listRoleGrants): solo administradores. 401, 403 y 422 los aplica el servicio.
export function listRoleGrantsHandler(deps: Deps) {
  return (request: Request) =>
    guarded("role_grant.list_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const params = new URL(request.url).searchParams;
      const query = { role: params.get("role"), page: params.get("page"), pageSize: params.get("pageSize") };
      return json(await listRoleGrants(deps.db(), deps.config(), actor, query));
    });
}

// POST /api/v1/consents/revocations (revokeMyAuthorization). Orden: 401, 403 sin cuenta, 422, 409 `principal_admin_protected` y luego `last_admin_protected` (F035).
// Por HTTP el canal siempre es `mini_app`; no exige la versión vigente del aviso (ADR 0005).
export function revokeMyAuthorizationHandler(deps: Deps) {
  return (request: Request) =>
    guarded("consent.revoke_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await revokeMyAuthorization(deps.db(), deps.config(), actor, body, "mini_app", deps.now()));
    });
}

type GrantRoute = { params: Promise<{ grantId: string }> };

// POST /api/v1/role-grants/{grantId}/revocation (revokeRole). Orden (contrato F006, criterio 31): 401, 403, 422, 404, 409.
// No avisa a la persona afectada (D-127).
export function revokeRoleHandler(deps: Deps) {
  return (request: Request, context: GrantRoute) =>
    guarded("role_grant.revoke_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const { grantId } = await context.params;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await revokeRole(deps.db(), deps.config(), actor, grantId, body, deps.now()));
    });
}

// ---- Listas cerradas (F011) ------------------------------------------------------------------------------------
// GET lee con el aviso vigente (D-039); POST y PATCH son solo del administrador (D-041). Orden de las escrituras:
// 401, 403 `consent_required`, 403 `forbidden`, 422, 404 y 409; lo aplica el servicio.
export function listCatalogHandler(deps: Deps, kind: CatalogKind) {
  return (request: Request) =>
    guarded(`${kind}.list_failed`, async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await listCatalog(deps.db(), actor, kind));
    });
}

export function createCatalogItemHandler(deps: Deps, kind: CatalogKind) {
  return (request: Request) =>
    guarded(`${kind}.create_failed`, async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await createCatalogItem(deps.db(), deps.config(), actor, kind, body, deps.now()), 201);
    });
}

// `idParam` es el nombre del parámetro de la ruta (categoryId, experienceTypeId, establishmentTypeId).
export function renameCatalogItemHandler<P extends string>(deps: Deps, kind: CatalogKind, idParam: P) {
  return (request: Request, context: { params: Promise<Record<P, string>> }) =>
    guarded(`${kind}.update_failed`, async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const id = (await context.params)[idParam];
      const body: unknown = await request.json().catch(() => undefined);
      return json(await renameCatalogItem(deps.db(), deps.config(), actor, kind, id, body, deps.now()));
    });
}

// ---- Fichas (F012) ---------------------------------------------------------------------------------------------
// POST /api/v1/managed-listings (createListing): atractivo del administrador (F012) o establecimiento del prestador (F013).
// Orden: 401, 403 `consent_required`, 403 `forbidden`, 422, 409 `duplicate`; los aplica el servicio.
export function createListingHandler(deps: Deps) {
  return (request: Request) =>
    guarded("listing.create_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await createListing(deps.db(), deps.config(), actor, body, deps.now()), 201);
    });
}

// GET /api/v1/public/listings (listPublishedListings): cualquier cuenta con el aviso vigente (D-039).
export function listPublishedListingsHandler(deps: Deps) {
  return (request: Request) =>
    guarded("listing.list_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await listPublishedListings(deps.db(), actor, new URL(request.url).searchParams));
    });
}

// GET /api/v1/managed-listings (listManagedListings): prestador (lo suyo) y administrador (desde que se envían).
export function listManagedListingsHandler(deps: Deps) {
  return (request: Request) =>
    guarded("listing.list_managed_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await listManagedListings(deps.db(), deps.config(), actor, new URL(request.url).searchParams));
    });
}

type ListingRoute = { params: Promise<{ listingId: string }> };

// GET /api/v1/managed-listings/{listingId} (getManagedListing). Una ficha ajena o inexistente responde 403.
export function getManagedListingHandler(deps: Deps) {
  return (request: Request, context: ListingRoute) =>
    guarded("listing.get_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const { listingId } = await context.params;
      return json(await getManagedListing(deps.db(), deps.config(), actor, listingId));
    });
}

// PUT .../draft (saveListingDraft) y POST .../submission (submitListingForReview): solo prestador. Orden: 401, 403
// `consent_required`, 403 `forbidden` (rol o ficha ajena), 409 `invalid_state_transition`, 422 y 409 `duplicate`.
export function saveListingDraftHandler(deps: Deps) {
  return (request: Request, context: ListingRoute) =>
    guarded("listing.save_draft_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const { listingId } = await context.params;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await saveListingDraft(deps.db(), deps.config(), actor, listingId, body, deps.now()));
    });
}

export function submitListingForReviewHandler(deps: Deps) {
  return (request: Request, context: ListingRoute) =>
    guarded("listing.submit_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      const { listingId } = await context.params;
      const body: unknown = await request.json().catch(() => undefined);
      return json(await submitListingForReview(deps.db(), deps.config(), actor, listingId, body, deps.now()));
    });
}
