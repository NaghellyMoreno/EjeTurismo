import { sql } from "kysely";
import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { parsePublishedListQuery } from "@/server/domain/listings";
import { parseApproval, parseRejection } from "@/server/domain/review";
import { AppError } from "@/server/errors";
import { validationFailed, type ManagedListing } from "./listings";
import { loadManagedListing } from "./managed-listings";
import { ensurePrincipalGrant } from "./principal-grant";
import { assertAdmin } from "./provider-review";
import { getActiveRoles } from "./provider-registration";
import type { Db } from "./types";

type ReviewSummaryPage = components["schemas"]["ReviewSummaryPage"];
type Review = components["schemas"]["Review"];
type ListingVersionView = components["schemas"]["ListingVersion"];
type ChangedField = Review["changedFields"][number];

export const LISTING_APPROVED_ACTION = "listing.approved";
export const LISTING_REJECTED_ACTION = "listing.rejected";
export const TEMPLATE_LISTING_APPROVED = "listing_approved";
export const TEMPLATE_LISTING_REJECTED = "listing_rejected";

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const notFound = () => new AppError("not_found", 404, "Ficha por revisar no encontrada", undefined, { detail: "No encontramos la ficha por revisar." });
const notPending = () => new AppError("invalid_state_transition", 409, "Estado no permitido", undefined, { detail: "La ficha ya no está pendiente de revisión." });

// El dueño de la ficha ya no tiene el permiso de prestador (D-029, P11): no se puede aprobar. El bot lo distingue del 409 común.
export class OwnerRevokedError extends AppError {
  constructor() {
    super("invalid_state_transition", 409, "Estado no permitido", undefined, { detail: "La ficha ya no está pendiente de revisión." });
    this.name = "OwnerRevokedError";
  }
}

// ---- Lista --------------------------------------------------------------------------------------------------------

// GET /reviews: versiones `pending`, la más antigua primero (D-095). Orden: 401, 403 `consent_required`, 403 `forbidden`, 422.
export async function listPendingReviews(db: Db, config: Config, actor: Actor, params: URLSearchParams): Promise<ReviewSummaryPage> {
  await assertAdmin(db, config, actor);
  const parsed = parsePublishedListQuery(new URLSearchParams([...params].filter(([key]) => key === "page" || key === "pageSize")));
  if (!parsed.ok) throw validationFailed(parsed.errors);
  const { page, pageSize } = parsed.query;

  const total = await db.selectFrom("listing_versions").select((eb) => eb.fn.countAll<string>().as("n")).where("status", "=", "pending").executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom("listing_versions as v")
    .innerJoin("listings as l", "l.id", "v.listing_id")
    .innerJoin("municipalities as m", "m.id", "v.municipality_id")
    .select([
      "v.id", "v.listing_id", "l.kind", "v.name", "m.id as municipality_id", "m.name as municipality_name",
      sql<Date>`coalesce(v.submitted_at, v.updated_at)`.as("submitted_at"),
      sql<boolean>`exists (select 1 from app.listing_versions p where p.listing_id = v.listing_id and p.status = 'published')`.as("is_edit"),
    ])
    .where("v.status", "=", "pending")
    .orderBy(sql`coalesce(v.submitted_at, v.updated_at)`, "asc")
    .orderBy("v.id", "asc")
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();
  return {
    page,
    pageSize,
    total: Number(total.n),
    items: rows.map((row) => ({
      versionId: row.id,
      listingId: row.listing_id,
      kind: row.kind,
      name: row.name,
      municipality: { id: row.municipality_id, name: row.municipality_name },
      submittedAt: new Date(row.submitted_at).toISOString(),
      isEditOfPublished: row.is_edit,
    })),
  };
}

// ---- Detalle ------------------------------------------------------------------------------------------------------

const CONTENT_FIELDS: [ChangedField, (v: ListingVersionView) => string | null][] = [
  ["name", (v) => v.content.name],
  ["municipality", (v) => v.content.municipality.id],
  ["category", (v) => v.content.category?.id ?? null],
  ["establishmentType", (v) => v.content.establishmentType?.id ?? null],
  ["experienceType", (v) => v.content.experienceType?.id ?? null],
  ["description", (v) => v.content.description ?? null],
  ["schedule", (v) => v.content.schedule ?? null],
  ["contact", (v) => v.content.contact ?? null],
  ["mapsUrl", (v) => v.content.mapsUrl ?? null],
  ["guidesInfo", (v) => v.content.guidesInfo ?? null],
];

// P5: sin versión publicada, los campos que traen valor; con ella, solo los distintos (`photos` llega con F020).
export function changedFields(proposed: ListingVersionView, published: ListingVersionView | null): ChangedField[] {
  return CONTENT_FIELDS.filter(([, read]) => (published ? read(proposed) !== read(published) : read(proposed) !== null)).map(([field]) => field);
}

async function pendingVersion(db: Db, versionId: string): Promise<{ id: string; listing_id: string } | null> {
  if (!isUuid(versionId)) return null;
  return (await db.selectFrom("listing_versions").select(["id", "listing_id"]).where("id", "=", versionId).where("status", "=", "pending").executeTakeFirst()) ?? null;
}

// GET /reviews/{versionId}: una versión pendiente y qué cambia. Una versión inexistente, mal formada o ya decidida es 404.
export async function getReview(db: Db, config: Config, actor: Actor, versionId: string): Promise<Review> {
  await assertAdmin(db, config, actor);
  const version = await pendingVersion(db, versionId);
  if (!version) throw notFound();
  const loaded = await loadManagedListing(db, version.listing_id);
  const proposed = loaded?.managed.working;
  if (!loaded || !proposed || proposed.id !== versionId) throw notFound();
  const published = loaded.managed.published ?? null;
  return {
    versionId,
    listingId: version.listing_id,
    kind: loaded.managed.kind,
    proposed,
    published,
    changedFields: changedFields(proposed, published),
  };
}

// ---- Decisión -----------------------------------------------------------------------------------------------------

export interface ReviewDecision {
  listing: ManagedListing;
  // Filas de `notification_outbox` creadas por la operación; el llamador las envía con `after()` (ADR 0007).
  notificationIds: string[];
}

// Una decisión es una sola transacción: estado de la versión (y de la publicada anterior), evento (disparador), traza y aviso.
// Orden: 401, 403 `consent_required`, 403 `forbidden`, 404, 422 y 409 `invalid_state_transition`.
async function decide(db: Db, config: Config, actor: Actor, versionId: string, rawBody: unknown, kind: "approve" | "reject", now: Date): Promise<ReviewDecision> {
  const admin = await assertAdmin(db, config, actor);
  const exists = isUuid(versionId) ? await db.selectFrom("listing_versions").select("id").where("id", "=", versionId).executeTakeFirst() : undefined;
  if (!exists) throw notFound();
  const parsed = kind === "approve" ? parseApproval(rawBody) : parseRejection(rawBody);
  if (!parsed.ok) throw validationFailed(parsed.errors);
  const reason = kind === "reject" ? (parsed.value.reason as string) : null;
  const approve = kind === "approve";

  const notificationIds: string[] = [];
  const listing = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.actor_role', 'admin', true), set_config('app.actor_account_id', ${admin.id}, true)`.execute(trx);
    // El administrador principal queda reflejado en `role_grants` (D-101): la base exige un administrador activo.
    await ensurePrincipalGrant(trx, config, actor.telegramUserId, now);
    // Bloquea la fila: dos decisiones simultáneas se atienden una tras otra y la segunda ve el estado ya cambiado.
    const version = await trx
      .selectFrom("listing_versions as v")
      .innerJoin("listings as l", "l.id", "v.listing_id")
      .leftJoin("businesses as b", "b.id", "l.business_id")
      .leftJoin("accounts as o", "o.id", "b.provider_account_id")
      .select(["v.id", "v.listing_id", "v.status", "v.name", "l.kind", "o.telegram_user_id as owner_telegram_id"])
      .where("v.id", "=", versionId)
      .forUpdate("v")
      .executeTakeFirst();
    if (!version) throw notFound();
    if (version.status !== "pending") throw notPending();

    // P11 (D-029): la ficha de quien ya no es prestador no se publica ni avisa; sí se puede rechazar.
    const hasOwner = version.kind === "establishment";
    const ownerActive = !hasOwner || (version.owner_telegram_id !== null && (await getActiveRoles(trx, String(version.owner_telegram_id))).includes("provider"));
    if (approve && !ownerActive) throw new OwnerRevokedError();

    if (approve) {
      await trx.updateTable("listing_versions").set({ status: "superseded", updated_at: now }).where("listing_id", "=", version.listing_id).where("status", "=", "published").execute();
    }
    await trx
      .updateTable("listing_versions")
      .set({ status: approve ? "published" : "rejected", decided_at: now, decided_by: admin.id, rejection_reason: reason, updated_at: now })
      .where("id", "=", versionId)
      .execute();
    await trx
      .insertInto("audit_events")
      .values({
        occurred_at: now,
        actor_account_id: admin.id,
        actor_role: "admin",
        action: approve ? LISTING_APPROVED_ACTION : LISTING_REJECTED_ACTION,
        entity_type: "listing",
        entity_id: version.listing_id,
        details: JSON.stringify({ kind: version.kind, listingId: version.listing_id, versionId }),
      })
      .execute();
    if (ownerActive && version.owner_telegram_id !== null) {
      const outbox = await trx
        .insertInto("notification_outbox")
        .values({
          recipient_telegram_user_id: String(version.owner_telegram_id),
          template: approve ? TEMPLATE_LISTING_APPROVED : TEMPLATE_LISTING_REJECTED,
          payload: JSON.stringify(approve ? { listingName: version.name } : { listingName: version.name, reason }),
          created_at: now,
          next_attempt_at: null,
          sent_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      notificationIds.push(outbox.id);
    }
    return (await loadManagedListing(trx, version.listing_id))!.managed;
  });
  return { listing, notificationIds };
}

export const approveListingVersion = (db: Db, config: Config, actor: Actor, versionId: string, body: unknown, now: Date = new Date()) =>
  decide(db, config, actor, versionId, body, "approve", now);

export const rejectListingVersion = (db: Db, config: Config, actor: Actor, versionId: string, body: unknown, now: Date = new Date()) =>
  decide(db, config, actor, versionId, body, "reject", now);
