import { sql } from "kysely";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import {
  missingToSubmit,
  parseDraftSave,
  parseEstablishmentCreate,
  parseManagedListQuery,
  parseSubmission,
  type DraftContent,
  listingErrorMessage,
} from "@/server/domain/listings";
import { normalizeName } from "@/server/domain/normalize-name";
import { AppError, type FieldError } from "@/server/errors";
import { getConsentState } from "./consent";
import { createAttractionListing, LISTING_CREATED_ACTION, validationFailed, type ManagedListing } from "./listings";
import { getActiveRoles } from "./provider-registration";
import type { Db } from "./types";

type ManagedListingSummaryPage = components["schemas"]["ManagedListingSummaryPage"];
type ListingVersionView = components["schemas"]["ListingVersion"];

export const LISTING_SUBMITTED_ACTION = "listing.submitted";
const PENDING_DETAIL = "La ficha está pendiente de revisión y no se puede editar.";

const forbidden = (detail = "Sin permiso para esta ficha") => new AppError("forbidden", 403, detail);
const isDuplicateName = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === "23P01";
const duplicateError = () => new AppError("duplicate", 409, "Ficha duplicada", undefined, { detail: "Ya existe una ficha con ese nombre en ese municipio." });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Caller {
  accountId: string;
  displayName: string | null;
  isAdmin: boolean;
  isProvider: boolean;
}

// Consentimiento vigente (403 `consent_required`) y rol leído de la base en cada llamada (D-108): 403 `forbidden` sin rol.
async function loadCaller(db: Db, config: Config, actor: Actor): Promise<Caller> {
  const state = await getConsentState(db, actor.telegramUserId);
  assertConsented(state);
  const roles = await getActiveRoles(db, actor.telegramUserId);
  const isAdmin = config.principalAdminTelegramId === actor.telegramUserId || roles.includes("admin");
  const isProvider = !isAdmin && roles.includes("provider");
  if (!isAdmin && !isProvider) throw forbidden("Sin rol para gestionar fichas");
  return { accountId: state.account!.id, displayName: state.account!.displayName, isAdmin, isProvider };
}

// ---- Lectura de una ficha gestionada --------------------------------------------------------------------------

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export async function loadManagedListing(db: Db, listingId: string): Promise<{ managed: ManagedListing; ownerAccountId: string | null } | null> {
  const listing = await db
    .selectFrom("listings as l")
    .leftJoin("businesses as b", "b.id", "l.business_id")
    .select(["l.id", "l.kind", "l.business_id", "l.created_at", "b.provider_account_id"])
    .where("l.id", "=", listingId)
    .executeTakeFirst();
  if (!listing) return null;
  const rows = await db
    .selectFrom("listing_versions as v")
    .innerJoin("municipalities as m", "m.id", "v.municipality_id")
    .leftJoin("categories as c", "c.id", "v.category_id")
    .leftJoin("establishment_types as t", "t.id", "v.establishment_type_id")
    .leftJoin("experience_types as x", "x.id", "v.experience_type_id")
    .leftJoin("accounts as d", "d.id", "v.decided_by")
    .select([
      "v.id", "v.version_number", "v.status", "v.name", "v.description", "v.schedule", "v.contact", "v.maps_url", "v.guides_info",
      "v.third_party_declared_at", "v.submitted_at", "v.decided_at", "v.decided_by", "v.rejection_reason", "v.created_at", "v.updated_at",
      "m.id as municipality_id", "m.name as municipality_name", "c.id as category_id", "c.name as category_name",
      "t.id as type_id", "t.name as type_name", "x.id as experience_id", "x.name as experience_name", "d.telegram_display_name as decider_name",
    ])
    .where("v.listing_id", "=", listingId)
    .where("v.status", "in", ["draft", "pending", "published", "rejected"])
    .orderBy("v.version_number", "desc")
    .execute();

  const view = (row: (typeof rows)[number]): ListingVersionView => ({
    id: row.id,
    versionNumber: row.version_number,
    status: row.status,
    content: {
      name: row.name,
      municipality: { id: row.municipality_id, name: row.municipality_name },
      category: row.category_id && row.category_name ? { id: row.category_id, name: row.category_name } : null,
      ...(listing.kind === "establishment" ? { establishmentType: row.type_id && row.type_name ? { id: row.type_id, name: row.type_name } : null } : {}),
      ...(listing.kind === "route_experience"
        ? { experienceType: row.experience_id && row.experience_name ? { id: row.experience_id, name: row.experience_name } : null, guidesInfo: row.guides_info }
        : {}),
      description: row.description,
      schedule: row.schedule,
      contact: row.contact,
      mapsUrl: row.maps_url,
    },
    photos: [],
    photosTotalBytes: 0,
    thirdPartyDeclaredAt: iso(row.third_party_declared_at),
    submittedAt: iso(row.submitted_at),
    decidedAt: iso(row.decided_at),
    ...(row.decided_by ? { decidedBy: { displayName: row.decider_name, role: "admin" as const } } : {}),
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });

  const published = rows.find((row) => row.status === "published");
  const open = rows.find((row) => row.status === "draft" || row.status === "pending");
  const lastRejected = rows.find((row) => row.status === "rejected" && row.version_number > (published?.version_number ?? 0));
  const working = open ?? lastRejected;
  const managed: ManagedListing = {
    id: listing.id,
    kind: listing.kind,
    businessId: listing.business_id,
    // Una edición rechazada de una ficha publicada no cambia lo que se ve: sigue `published` y el motivo va en `lastRejection` (P6).
    displayStatus: !working || (working === lastRejected && published) ? "published" : (working.status as "draft" | "pending" | "rejected"),
    hasPublishedVersion: Boolean(published),
    published: published ? view(published) : null,
    working: working ? view(working) : null,
    // El motivo se conserva mientras el prestador corrige (borrador nuevo) y deja de mostrarse al volver a `pending` (P6).
    ...(lastRejected && (working === lastRejected || working?.status === "draft") && lastRejected.rejection_reason
      ? { lastRejection: { reason: lastRejected.rejection_reason, rejectedAt: (lastRejected.decided_at ?? lastRejected.updated_at).toISOString() } }
      : {}),
    acceptsRequests: false,
    createdAt: listing.created_at.toISOString(),
  };
  return { managed, ownerAccountId: listing.provider_account_id };
}

const reload = async (db: Db, listingId: string): Promise<ManagedListing> => (await loadManagedListing(db, listingId))!.managed;

// ---- Referencias del contenido ------------------------------------------------------------------------------------

async function checkReferences(db: Db, content: DraftContent): Promise<{ municipalityName: string }> {
  const [municipality, category, type] = await Promise.all([
    db.selectFrom("municipalities").select("name").where("id", "=", content.municipalityId).executeTakeFirst(),
    content.categoryId ? db.selectFrom("categories").select("id").where("id", "=", content.categoryId).executeTakeFirst() : Promise.resolve(true),
    content.establishmentTypeId ? db.selectFrom("establishment_types").select("id").where("id", "=", content.establishmentTypeId).executeTakeFirst() : Promise.resolve(true),
  ]);
  const missing: FieldError[] = [];
  const notFound = (field: string): FieldError => ({ field, code: "not_found", message: listingErrorMessage(field, "not_found") });
  if (!municipality) missing.push(notFound("municipalityId"));
  if (!category) missing.push(notFound("categoryId"));
  if (!type) missing.push(notFound("establishmentTypeId"));
  if (missing.length > 0) throw validationFailed(missing);
  return { municipalityName: municipality!.name };
}

const contentColumns = (content: DraftContent) => ({
  name: content.name,
  name_normalized: normalizeName(content.name),
  municipality_id: content.municipalityId,
  category_id: content.categoryId,
  establishment_type_id: content.establishmentTypeId,
  description: content.description,
  schedule: content.schedule,
  contact: content.contact,
  maps_url: content.mapsUrl,
});

// ---- createListing ---------------------------------------------------------------------------------------------

// Administrador: atractivo (F012). Prestador: establecimiento en borrador (D-006). Orden: 401 (ruta), 403
// `consent_required`, 403 `forbidden`, 422 y 409 `duplicate`. Un rechazo no deja negocio, ficha ni versión.
export async function createListing(db: Db, config: Config, actor: Actor, rawBody: unknown, now: Date = new Date()): Promise<ManagedListing> {
  const caller = await loadCaller(db, config, actor);
  if (caller.isAdmin) return createAttractionListing(db, config, actor, rawBody, now);

  const parsed = parseEstablishmentCreate(rawBody);
  if (!parsed.ok) {
    if ("forbiddenKind" in parsed) throw forbidden("Sin permiso para este tipo de ficha");
    throw validationFailed(parsed.errors);
  }
  const { content } = parsed;
  await checkReferences(db, content);

  try {
    return await db.transaction().execute(async (trx) => {
      await sql`select set_config('app.actor_role', 'provider', true), set_config('app.actor_account_id', ${caller.accountId}, true)`.execute(trx);
      const business = await trx.insertInto("businesses").values({ provider_account_id: caller.accountId, created_at: now }).returning("id").executeTakeFirstOrThrow();
      const listing = await trx
        .insertInto("listings")
        .values({ kind: "establishment", business_id: business.id, created_by_account_id: caller.accountId, created_at: now })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("listing_versions")
        .values({ listing_id: listing.id, version_number: 1, status: "draft", ...contentColumns(content), created_at: now, updated_at: now })
        .execute();
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: caller.accountId,
          actor_role: "provider",
          action: LISTING_CREATED_ACTION,
          entity_type: "listing",
          entity_id: listing.id,
          details: JSON.stringify({ kind: "establishment", businessId: business.id, municipalityId: content.municipalityId }),
        })
        .execute();
      return await reload(trx, listing.id);
    });
  } catch (error) {
    if (isDuplicateName(error)) throw duplicateError();
    throw error;
  }
}

// ---- Ficha propia (invariante 2) -----------------------------------------------------------------------------------

// El prestador solo opera sobre fichas de su negocio; una ficha ajena, inexistente o con ID mal formado responde igual
// (403, sin revelar si existe).
async function assertOwnListing(db: Db, caller: Caller, listingId: string): Promise<void> {
  if (!caller.isProvider) throw forbidden();
  if (!uuidPattern.test(listingId)) throw forbidden();
  const row = await db
    .selectFrom("listings as l")
    .innerJoin("businesses as b", "b.id", "l.business_id")
    .select("l.id")
    .where("l.id", "=", listingId)
    .where("b.provider_account_id", "=", caller.accountId)
    .executeTakeFirst();
  if (!row) throw forbidden();
}

const stateError = () => new AppError("invalid_state_transition", 409, "Estado no permitido", undefined, { detail: PENDING_DETAIL });

// PUT .../draft: reemplaza el contenido completo del borrador propio. Una versión que no es borrador no se edita (409).
export async function saveListingDraft(db: Db, config: Config, actor: Actor, listingId: string, rawBody: unknown, now: Date = new Date()): Promise<ManagedListing> {
  const caller = await loadCaller(db, config, actor);
  await assertOwnListing(db, caller, listingId);
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`select set_config('app.actor_role', 'provider', true), set_config('app.actor_account_id', ${caller.accountId}, true)`.execute(trx);
      // Una ficha rechazada que nunca se publicó se corrige con una versión nueva en borrador (P4). Con sus versiones bloqueadas,
      // dos correcciones simultáneas se atienden una tras otra; si la segunda no ve el borrador nuevo, el único parcial de una
      // versión abierta la rechaza y se responde 409 (más abajo).
      const versions = await trx
        .selectFrom("listing_versions")
        .select(["id", "status", "version_number"])
        .where("listing_id", "=", listingId)
        .where("status", "in", ["draft", "pending", "published", "rejected"])
        .orderBy("version_number", "desc")
        .forUpdate()
        .execute();
      const open = versions.find((v) => v.status === "draft" || v.status === "pending");
      const reopen = !open && versions[0]?.status === "rejected" && !versions.some((v) => v.status === "published") ? versions[0] : undefined;
      if (!reopen && (!open || open.status !== "draft")) throw stateError();
      const parsed = parseDraftSave(rawBody);
      if (!parsed.ok) throw validationFailed(parsed.errors);
      await checkReferences(trx, parsed.content);
      if (reopen) {
        await trx
          .insertInto("listing_versions")
          .values({ listing_id: listingId, version_number: reopen.version_number + 1, status: "draft", ...contentColumns(parsed.content), created_at: now, updated_at: now })
          .execute();
      } else {
        await trx.updateTable("listing_versions").set({ ...contentColumns(parsed.content), updated_at: now }).where("id", "=", open!.id).execute();
      }
      return await reload(trx, listingId);
    });
  } catch (error) {
    if (isDuplicateName(error)) throw duplicateError();
    if ((error as { code?: unknown } | null)?.code === "23505") throw stateError();
    throw error;
  }
}

// POST .../submission: pasa el borrador a `pending` si el contenido guardado trae los 7 campos de D-003 y vienen la
// declaración (D-024) y la confirmación. Orden: 403, 409 (no es borrador), 422 (todo junto).
export async function submitListingForReview(db: Db, config: Config, actor: Actor, listingId: string, rawBody: unknown, now: Date = new Date()): Promise<ManagedListing> {
  const caller = await loadCaller(db, config, actor);
  await assertOwnListing(db, caller, listingId);
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.actor_role', 'provider', true), set_config('app.actor_account_id', ${caller.accountId}, true)`.execute(trx);
    const version = await trx
      .selectFrom("listing_versions")
      .select(["id", "status", "category_id", "description", "schedule", "contact", "maps_url"])
      .where("listing_id", "=", listingId)
      .where("status", "in", ["draft", "pending"])
      .forUpdate()
      .executeTakeFirst();
    if (!version || version.status !== "draft") throw stateError();

    const errors: FieldError[] = [];
    errors.push(...missingToSubmit({ categoryId: version.category_id, description: version.description, schedule: version.schedule, contact: version.contact, mapsUrl: version.maps_url }));
    const parsed = parseSubmission(rawBody);
    if (!parsed.ok) errors.push(...parsed.errors);
    if (errors.length > 0) throw validationFailed(errors);

    await trx
      .updateTable("listing_versions")
      .set({ status: "pending", submitted_at: now, submitted_by: caller.accountId, third_party_declared_at: now, updated_at: now })
      .where("id", "=", version.id)
      .execute();
    await trx
      .insertInto("audit_events")
      .values({
        occurred_at: now,
        actor_account_id: caller.accountId,
        actor_role: "provider",
        action: LISTING_SUBMITTED_ACTION,
        entity_type: "listing",
        entity_id: listingId,
        details: JSON.stringify({ kind: "establishment", versionId: version.id }),
      })
      .execute();
    return await reload(trx, listingId);
  });
}

// ---- Lectura ---------------------------------------------------------------------------------------------------

export async function getManagedListing(db: Db, config: Config, actor: Actor, listingId: string): Promise<ManagedListing> {
  const caller = await loadCaller(db, config, actor);
  if (!uuidPattern.test(listingId)) throw forbidden();
  const found = await loadManagedListing(db, listingId);
  if (!found) throw forbidden();
  // Prestador: solo su negocio. Administrador: atractivos y fichas desde que se envían (sin borradores ajenos).
  if (caller.isProvider && found.ownerAccountId !== caller.accountId) throw forbidden();
  if (caller.isAdmin && found.managed.displayStatus === "draft") throw forbidden();
  return found.managed;
}

// Estado que ve el prestador: la versión abierta (borrador o pendiente), si no la última rechazada posterior a la
// publicada, y si no la publicada. Una sola consulta con paginación y total.
export async function listManagedListings(db: Db, config: Config, actor: Actor, params: URLSearchParams): Promise<ManagedListingSummaryPage> {
  const caller = await loadCaller(db, config, actor);
  const parsed = parseManagedListQuery(params);
  if (!parsed.ok) throw validationFailed(parsed.errors);
  const { page, pageSize, kind } = parsed.query;
  // Administrador sin filtro: pendientes de aprobación (valor por defecto del contrato); nunca borradores.
  const displayStatus = parsed.query.displayStatus ?? (caller.isAdmin ? "pending" : undefined);

  const conditions = [caller.isProvider ? sql`b.provider_account_id = ${caller.accountId}` : sql`w.status <> 'draft'`];
  if (kind) conditions.push(sql`l.kind = ${kind}`);
  if (displayStatus) conditions.push(sql`w.shown = ${displayStatus}`);
  const from = sql`
    from app.listings l
    left join app.businesses b on b.id = l.business_id
    cross join lateral (
      select v.*,
        case when v.status = 'rejected' and exists (select 1 from app.listing_versions p where p.listing_id = l.id and p.status = 'published')
          then 'published' else v.status end as shown
      from app.listing_versions v
      where v.listing_id = l.id and v.status in ('draft', 'pending', 'published', 'rejected')
        and (v.status <> 'rejected' or v.version_number > coalesce(
          (select max(p.version_number) from app.listing_versions p where p.listing_id = l.id and p.status = 'published'), 0))
      order by case v.status when 'draft' then 0 when 'pending' then 0 when 'rejected' then 1 else 2 end, v.version_number desc
      limit 1
    ) w
    join app.municipalities m on m.id = w.municipality_id
    where ${sql.join(conditions, sql` and `)}`;

  const total = await sql<{ count: string }>`select count(*)::text as count ${from}`.execute(db);
  const rows = await sql<{
    id: string; kind: components["schemas"]["ListingKind"]; name: string; municipality_id: string; municipality_name: string;
    shown: "draft" | "pending" | "published" | "rejected"; updated_at: Date; has_published: boolean;
  }>`
    select l.id, l.kind, w.name, m.id as municipality_id, m.name as municipality_name, w.shown, w.updated_at,
      exists (select 1 from app.listing_versions p where p.listing_id = l.id and p.status = 'published') as has_published
    ${from}
    order by w.updated_at desc, l.id
    limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(db);

  return {
    page,
    pageSize,
    total: Number(total.rows[0]!.count),
    items: rows.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      municipality: { id: row.municipality_id, name: row.municipality_name },
      displayStatus: row.shown,
      hasPublishedVersion: row.has_published,
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
  };
}
