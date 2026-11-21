import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import { AppError } from "@/server/errors";
import { downloadPhoto, getStorage, type PhotoStorage } from "@/server/storage";
import { getConsentState } from "./consent";
import { uuidPattern } from "./managed-listings";
import { loadPhotos } from "./photo-views";
import type { Db } from "./types";

export type PublicListingDetail = components["schemas"]["PublicListingDetail"];

const notFound = () => new AppError("not_found", 404, "Ficha no encontrada", undefined, { detail: "No encontramos esa ficha." });

// GET /api/v1/public/listings/{listingId} (getPublishedListing, F020 P1): solo la versión publicada, con sus fotos y URLs firmadas de
// lectura (invariante 3). Exige el aviso vigente (D-039). No devuelve datos del prestador ni número de identidad (invariante 7).
export async function getPublishedListing(db: Db, actor: Actor, listingId: string, now: Date = new Date(), storage: PhotoStorage = getStorage()): Promise<PublicListingDetail> {
  assertConsented(await getConsentState(db, actor.telegramUserId));
  if (!uuidPattern.test(listingId)) throw notFound();
  const row = await db
    .selectFrom("listing_versions as v")
    .innerJoin("listings as l", "l.id", "v.listing_id")
    .innerJoin("municipalities as m", "m.id", "v.municipality_id")
    .leftJoin("categories as c", "c.id", "v.category_id")
    .leftJoin("establishment_types as t", "t.id", "v.establishment_type_id")
    .leftJoin("experience_types as x", "x.id", "v.experience_type_id")
    .leftJoin("businesses as b", "b.id", "l.business_id")
    .leftJoin("accounts as pa", "pa.id", "b.provider_account_id")
    .select((eb) => [
      "v.id", "l.kind", "v.name", "v.description", "v.schedule", "v.contact", "v.maps_url", "v.guides_info", "v.decided_at", "v.created_at",
      "m.id as municipality_id", "m.name as municipality_name", "c.id as category_id", "c.name as category_name",
      "t.id as type_id", "t.name as type_name", "x.id as experience_id", "x.name as experience_name",
      // F030: solo las fichas de un prestador con rol activo reciben solicitudes (D-005, D-029, D-043).
      eb
        .exists(
          eb
            .selectFrom("role_grants as g")
            .select("g.id")
            .whereRef("g.telegram_user_id", "=", "pa.telegram_user_id")
            .where("g.role", "=", "provider")
            .where("g.revoked_at", "is", null),
        )
        .as("provider_active"),
    ])
    .where("l.id", "=", listingId)
    .where("v.status", "=", "published")
    .executeTakeFirst();
  if (!row) throw notFound();
  const photos = (await loadPhotos(db, [row.id], storage, now)).get(row.id)?.photos ?? [];
  return {
    id: listingId,
    kind: row.kind,
    name: row.name,
    municipality: { id: row.municipality_id, name: row.municipality_name },
    category: { id: row.category_id!, name: row.category_name! },
    ...(row.kind === "establishment" ? { establishmentType: row.type_id && row.type_name ? { id: row.type_id, name: row.type_name } : null } : {}),
    ...(row.kind === "route_experience"
      ? { experienceType: row.experience_id && row.experience_name ? { id: row.experience_id, name: row.experience_name } : null, guidesInfo: row.guides_info }
      : {}),
    description: row.description!,
    schedule: row.schedule!,
    contact: row.contact!,
    mapsUrl: row.maps_url!,
    photos,
    acceptsRequests: row.provider_active === true,
    publishedAt: (row.decided_at ?? row.created_at).toISOString(),
  };
}

// Respaldo del envío de fotos del bot (F023): descarga la foto de una URL firmada que devolvió `getPublishedListing`.
export const downloadPublishedPhoto = downloadPhoto;
