import { sql } from "kysely";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import { CONFIRMATION_REQUIRED_TEXT, parseAttractionCreate, parsePublishedListQuery, listingErrorMessage } from "@/server/domain/listings";
import { normalizeName } from "@/server/domain/normalize-name";
import { AppError, type FieldError } from "@/server/errors";
import { getConsentState } from "./consent";
import { assertAdmin } from "./provider-review";
import type { Db } from "./types";

export type ManagedListing = components["schemas"]["ManagedListing"];
export type PublicListingSummaryPage = components["schemas"]["PublicListingSummaryPage"];

export const LISTING_CREATED_ACTION = "listing.created";

const VALIDATION_DETAIL = "Revisa los campos marcados.";
export const validationFailed = (errors: FieldError[]) =>
  new AppError("validation_failed", 422, "Datos inválidos", errors, {
    detail: errors.length === 1 && errors[0]!.field === "confirmed" ? CONFIRMATION_REQUIRED_TEXT : VALIDATION_DETAIL,
  });

// 23P01: la restricción de exclusión de nombres por municipio (D-003, D-118; ADR 0002).
const isDuplicateName = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === "23P01";

// Crear un atractivo (HU-009, D-005): solo el administrador; queda publicado sin validación. Orden: 401 (ruta), 403
// `consent_required`, 403 `forbidden` (también para otro `kind`), 422, y 409 `duplicate`. Un rechazo no escribe nada.
// Ficha, versión publicada, evento de estado (disparador) y `audit_events` van en una sola transacción.
export async function createAttractionListing(db: Db, config: Config, actor: Actor, rawBody: unknown, now: Date = new Date()): Promise<ManagedListing> {
  const admin = await assertAdmin(db, config, actor);
  const parsed = parseAttractionCreate(rawBody);
  if (!parsed.ok) {
    if ("forbiddenKind" in parsed) throw new AppError("forbidden", 403, "Sin permiso para este tipo de ficha");
    throw validationFailed(parsed.errors);
  }
  const { content } = parsed;

  // Las listas solo crecen (no hay DELETE), así que comprobar antes de insertar no deja una ventana de error.
  const [municipality, category] = await Promise.all([
    db.selectFrom("municipalities").select(["id", "name"]).where("id", "=", content.municipalityId).executeTakeFirst(),
    db.selectFrom("categories").select(["id", "name"]).where("id", "=", content.categoryId).executeTakeFirst(),
  ]);
  const missing: FieldError[] = [];
  if (!municipality) missing.push({ field: "municipalityId", code: "not_found", message: listingErrorMessage("municipalityId", "not_found") });
  if (!category) missing.push({ field: "categoryId", code: "not_found", message: listingErrorMessage("categoryId", "not_found") });
  if (!municipality || !category) throw validationFailed(missing);

  try {
    return await db.transaction().execute(async (trx) => {
      await sql`select set_config('app.actor_role', 'admin', true)`.execute(trx);
      const listing = await trx
        .insertInto("listings")
        .values({ kind: "attraction", business_id: null, created_by_account_id: admin.id, created_at: now })
        .returning(["id", "created_at"])
        .executeTakeFirstOrThrow();
      const version = await trx
        .insertInto("listing_versions")
        .values({
          listing_id: listing.id,
          version_number: 1,
          status: "published",
          name: content.name,
          name_normalized: normalizeName(content.name),
          municipality_id: municipality.id,
          category_id: category.id,
          description: content.description,
          schedule: content.schedule,
          contact: content.contact,
          maps_url: content.mapsUrl,
          decided_at: now,
          decided_by: admin.id,
          created_at: now,
          updated_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: admin.id,
          actor_role: "admin",
          action: LISTING_CREATED_ACTION,
          entity_type: "listing",
          entity_id: listing.id,
          details: JSON.stringify({ kind: "attraction", municipalityId: municipality.id, categoryId: category.id }),
        })
        .execute();
      const at = now.toISOString();
      return {
        id: listing.id,
        kind: "attraction",
        businessId: null,
        displayStatus: "published",
        hasPublishedVersion: true,
        published: {
          id: version.id,
          versionNumber: 1,
          status: "published",
          content: {
            name: content.name,
            municipality: { id: municipality.id, name: municipality.name },
            category: { id: category.id, name: category.name },
            description: content.description,
            schedule: content.schedule,
            contact: content.contact,
            mapsUrl: content.mapsUrl,
          },
          photos: [],
          photosTotalBytes: 0,
          decidedAt: at,
          decidedBy: { displayName: admin.displayName, role: "admin" },
          createdAt: at,
          updatedAt: at,
        },
        working: null,
        acceptsRequests: false,
        createdAt: listing.created_at.toISOString(),
      } satisfies ManagedListing;
    });
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new AppError("duplicate", 409, "Ficha duplicada", undefined, { detail: "Ya existe una ficha con ese nombre en ese municipio." });
    }
    throw error;
  }
}

// Lista pública (HU-019, D-039): solo versiones publicadas, para cualquier cuenta con el aviso vigente. Orden por nombre
// normalizado y luego por ID de la ficha (D-146). No devuelve datos del prestador ni de quien publicó.
export async function listPublishedListings(db: Db, actor: Actor, params: URLSearchParams): Promise<PublicListingSummaryPage> {
  assertConsented(await getConsentState(db, actor.telegramUserId));
  const parsed = parsePublishedListQuery(params);
  if (!parsed.ok) throw validationFailed(parsed.errors);
  const { page, pageSize, municipalityId, categoryId, experienceTypeId, kind, gastronomic } = parsed.query;

  const filtered = () => {
    let query = db
      .selectFrom("listing_versions as v")
      .innerJoin("listings as l", "l.id", "v.listing_id")
      .where("v.status", "=", "published");
    if (municipalityId) query = query.where("v.municipality_id", "=", municipalityId);
    if (categoryId) query = query.where("v.category_id", "=", categoryId);
    if (kind) query = query.where("l.kind", "=", kind);
    // F024: solo las rutas y experiencias tienen tipo de experiencia; con `kind=establishment` el resultado es vacío (D-179).
    if (experienceTypeId) query = query.where("l.kind", "=", "route_experience").where("v.experience_type_id", "=", experienceTypeId);
    // F017 (HU-011): la marca vive solo en las listas cerradas (ADR 0004), según el tipo de la versión publicada.
    if (gastronomic) {
      query = query
        .leftJoin("establishment_types as et", "et.id", "v.establishment_type_id")
        .leftJoin("experience_types as xt", "xt.id", "v.experience_type_id")
        .where((eb) =>
          eb.or([
            eb.and([eb("l.kind", "=", "establishment"), eb("et.is_gastronomic", "=", true)]),
            eb.and([eb("l.kind", "=", "route_experience"), eb("xt.is_gastronomic", "=", true)]),
          ]),
        );
    }
    return query;
  };

  const total = await filtered().select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow();
  const rows = await filtered()
    .innerJoin("municipalities as m", "m.id", "v.municipality_id")
    .leftJoin("categories as c", "c.id", "v.category_id")
    .select(["l.id", "l.kind", "v.name", "m.id as municipality_id", "m.name as municipality_name", "c.id as category_id", "c.name as category_name"])
    .orderBy("v.name_normalized")
    .orderBy("l.id")
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();

  return {
    page,
    pageSize,
    total: Number(total.count),
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      municipality: { id: row.municipality_id, name: row.municipality_name },
      ...(row.category_id && row.category_name ? { category: { id: row.category_id, name: row.category_name } } : {}),
    })),
  };
}
