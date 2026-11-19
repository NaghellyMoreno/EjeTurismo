import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { photoTexts } from "@/lib/photo-texts";
import {
  detectImageType,
  MAX_BYTES_PER_VERSION,
  MAX_PHOTOS_PER_VERSION,
  PHOTO_EXTENSION,
  PHOTO_UPLOAD_ACTION,
  PHOTO_UPLOAD_TTL_MS,
  parsePhotoRegistration,
  parsePhotoUpload,
} from "@/server/domain/photos";
import { AppError, type FieldError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { getStorage, type PhotoStorage } from "@/server/storage";
import { validationFailed } from "./listings";
import { forbidden, loadCaller, uuidPattern, type Caller } from "./managed-listings";
import { toPhoto } from "./photo-views";
import { consumeRateLimit } from "./rate-limit";
import type { Db } from "./types";

type Photo = components["schemas"]["Photo"];
type PhotoUploadTicket = components["schemas"]["PhotoUploadTicket"];

export const PHOTO_ADDED_ACTION = "listing.photo_added";
export const PHOTO_REMOVED_ACTION = "listing.photo_removed";

const QUOTA_LOCK = 7_020; // bloqueo consultivo global de la cuota del almacén (ADR 0009)

const stateError = () => new AppError("invalid_state_transition", 409, "Estado no permitido", undefined, { detail: "Esta versión de la ficha no admite cambios en sus fotos." });
const limitError = () => new AppError("photo_limit_exceeded", 409, "Límite de fotos", undefined, { detail: photoTexts.limitReached });
const totalError = () => new AppError("photo_total_size_exceeded", 409, "Espacio de la ficha", undefined, { detail: photoTexts.totalExceeded });
const quotaError = () => new AppError("storage_quota_exceeded", 409, "Cuota del almacén", undefined, { detail: photoTexts.quotaExceeded });
const uploadNotFound = () => new AppError("upload_not_found", 409, "Subida no encontrada", undefined, { detail: "La subida no existe, venció o ya se registró." });
const uploadFailed = () => {
  const errors: FieldError[] = [{ field: "uploadId", code: "invalid_format", message: photoTexts.uploadFailed }];
  return new AppError("validation_failed", 422, "Datos inválidos", errors, { detail: photoTexts.uploadFailed });
};
const tooLarge = () => new AppError("photo_too_large", 422, "Foto demasiado pesada", undefined, { detail: photoTexts.tooLarge });
const photoNotFound = () => new AppError("not_found", 404, "Foto no encontrada", undefined, { detail: "No encontramos esa foto en la ficha." });

// Los disparadores de `listing_photos` responden 23514 con el nombre de la regla (migración f020_photos).
function fromTrigger(error: unknown): AppError | null {
  const found = error as { code?: unknown; constraint?: unknown } | null;
  if (found?.code !== "23514") return null;
  if (found.constraint === "listing_photos_limit") return limitError();
  if (found.constraint === "listing_photos_total_size") return totalError();
  if (found.constraint === "listing_photos_editable_version") return stateError();
  return null;
}

interface Target {
  kind: "attraction" | "establishment" | "route_experience";
  status: string;
}

const isEditable = (target: Target): boolean => (target.kind === "attraction" ? target.status === "published" : target.status === "draft");

// Permiso (invariantes 1 y 2): el prestador solo opera sobre fichas de su negocio y el administrador solo sobre atractivos. Una ficha o
// versión ajena, inexistente o mal formada responde igual (403, sin revelar si existe).
async function resolveTarget(db: Db, caller: Caller, listingId: string, versionId: string): Promise<Target> {
  if (!uuidPattern.test(listingId) || !uuidPattern.test(versionId)) throw forbidden();
  const row = await db
    .selectFrom("listing_versions as v")
    .innerJoin("listings as l", "l.id", "v.listing_id")
    .leftJoin("businesses as b", "b.id", "l.business_id")
    .select(["v.status", "l.kind", "b.provider_account_id"])
    .where("v.id", "=", versionId)
    .where("l.id", "=", listingId)
    .executeTakeFirst();
  if (!row) throw forbidden();
  if (caller.isAdmin ? row.kind !== "attraction" : row.provider_account_id !== caller.accountId) throw forbidden();
  return { kind: row.kind, status: row.status };
}

async function lockEditableVersion(trx: Db, listingId: string, versionId: string): Promise<boolean> {
  const row = await trx
    .selectFrom("listing_versions as v")
    .innerJoin("listings as l", "l.id", "v.listing_id")
    .select(["v.status", "l.kind"])
    .where("v.id", "=", versionId)
    .where("l.id", "=", listingId)
    .forUpdate("v")
    .executeTakeFirst();
  return Boolean(row) && isEditable({ kind: row!.kind, status: row!.status });
}

interface Usage {
  count: number;
  bytes: number;
}

async function versionUsage(trx: Db, versionId: string): Promise<Usage> {
  const { rows } = await sql<{ count: string; bytes: string }>`
    select count(*)::text as count, coalesce(sum(size_bytes), 0)::text as bytes from app.listing_photos where version_id = ${versionId}`.execute(trx);
  return { count: Number(rows[0]!.count), bytes: Number(rows[0]!.bytes) };
}

// Fotos vivas (un archivo compartido entre versiones se cuenta una sola vez) más las subidas emitidas que no vencieron ni se registraron.
async function storageUsed(trx: Db, now: Date, exceptUploadId?: string): Promise<number> {
  const { rows } = await sql<{ used: string }>`
    select (
      (select coalesce(sum(size_bytes), 0) from (select distinct on (blob_pathname) size_bytes from app.listing_photos order by blob_pathname) p)
      + (select coalesce(sum(declared_size), 0) from app.photo_uploads
          where registered_at is null and expires_at > ${now} and (${exceptUploadId ?? null}::uuid is null or id <> ${exceptUploadId ?? null}::uuid))
    )::text as used`.execute(trx);
  return Number(rows[0]!.used);
}

const actorRole = (caller: Caller): "admin" | "provider" => (caller.isAdmin ? "admin" : "provider");

// POST .../photo-uploads (createPhotoUpload). Orden: 401, 403 `consent_required`, 403 `forbidden`, 409 `invalid_state_transition`,
// 429 (cuenta el intento), 422 (tipo, tamaño) y 409 (10 fotos, 2 GB, cuota). Emitir la URL no escribe auditoría.
export async function createPhotoUpload(
  db: Db, config: Config, actor: Actor, listingId: string, versionId: string, rawBody: unknown, now: Date = new Date(), storage: PhotoStorage = getStorage(),
): Promise<PhotoUploadTicket> {
  const caller = await loadCaller(db, config, actor);
  const target = await resolveTarget(db, caller, listingId, versionId);
  if (!isEditable(target)) throw stateError();
  try {
    await consumeRateLimit(db, caller.accountId, PHOTO_UPLOAD_ACTION, config.rateLimits[PHOTO_UPLOAD_ACTION]!, now);
  } catch (error) {
    if (error instanceof AppError && error.code === "rate_limited") throw new AppError("rate_limited", 429, error.message, undefined, { ...error.options, detail: photoTexts.rateLimited });
    throw error;
  }
  const parsed = parsePhotoUpload(rawBody, config.photoMaxBytes);
  if (!parsed.ok) throw new AppError("validation_failed", 422, "Datos inválidos", parsed.errors, { detail: parsed.detail });
  const { contentType, sizeBytes } = parsed;

  try {
    return await db.transaction().execute(async (trx) => {
      if (!(await lockEditableVersion(trx, listingId, versionId))) throw stateError();
      await sql`select pg_advisory_xact_lock(${QUOTA_LOCK})`.execute(trx);
      const usage = await versionUsage(trx, versionId);
      if (usage.count >= MAX_PHOTOS_PER_VERSION) throw limitError();
      if (usage.bytes + sizeBytes > MAX_BYTES_PER_VERSION) throw totalError();
      if ((await storageUsed(trx, now)) + sizeBytes > config.blobStorageQuotaBytes) throw quotaError();

      const uploadId = randomUUID();
      const expiresAt = new Date(now.getTime() + PHOTO_UPLOAD_TTL_MS);
      const pathname = `listings/${listingId}/${uploadId}.${PHOTO_EXTENSION[contentType]}`;
      await trx
        .insertInto("photo_uploads")
        .values({ id: uploadId, version_id: versionId, requested_by_account_id: caller.accountId, pathname, declared_size: sizeBytes, content_type: contentType, expires_at: expiresAt, created_at: now })
        .execute();
      const uploadUrl = await storage.createUploadUrl({ pathname, contentType, maxSizeBytes: sizeBytes, expiresAt });
      return {
        uploadId,
        uploadUrl,
        method: "PUT" as const,
        expiresAt: expiresAt.toISOString(),
        maxSizeBytes: config.photoMaxBytes,
        contentType,
        remainingPhotos: MAX_PHOTOS_PER_VERSION - usage.count - 1,
        remainingBytes: Math.max(0, MAX_BYTES_PER_VERSION - usage.bytes - sizeBytes),
      };
    });
  } catch (error) {
    throw fromTrigger(error) ?? error;
  }
}

async function discard(storage: PhotoStorage, pathname: string): Promise<void> {
  try {
    await storage.delete(pathname);
  } catch (error) {
    logError("photo.delete_failed", error);
  }
}

// POST .../photos (registerPhoto). Orden: 401, 403 `consent_required`, 403 `forbidden`, 409 `invalid_state_transition`, 422 (cuerpo),
// 409 `upload_not_found`, verificación del archivo (422) y 409 de límites. Si el archivo no sirve, se borra del almacén.
export async function registerPhoto(
  db: Db, config: Config, actor: Actor, listingId: string, versionId: string, rawBody: unknown, now: Date = new Date(), storage: PhotoStorage = getStorage(),
): Promise<Photo> {
  const caller = await loadCaller(db, config, actor);
  const target = await resolveTarget(db, caller, listingId, versionId);
  if (!isEditable(target)) throw stateError();
  const parsed = parsePhotoRegistration(rawBody);
  if (!parsed.ok) throw validationFailed(parsed.errors);

  const upload = await db
    .selectFrom("photo_uploads")
    .select(["id", "pathname", "content_type"])
    .where("id", "=", parsed.uploadId)
    .where("version_id", "=", versionId)
    .where("requested_by_account_id", "=", caller.accountId)
    .where("registered_at", "is", null)
    .where("expires_at", ">", now)
    .executeTakeFirst();
  if (!upload) throw uploadNotFound();

  // El tamaño y la firma se leen del archivo subido, no de lo que declaró el cliente (D-042).
  const file = await storage.inspect(upload.pathname);
  if (!file || file.size < 1) {
    await discard(storage, upload.pathname);
    throw uploadFailed();
  }
  if (file.size > config.photoMaxBytes) {
    await discard(storage, upload.pathname);
    throw tooLarge();
  }
  if (detectImageType(file.firstBytes) !== upload.content_type) {
    await discard(storage, upload.pathname);
    throw uploadFailed();
  }

  type Outcome = { photo: Parameters<typeof toPhoto>[1] } | { error: AppError; cleanup: boolean };
  let outcome: Outcome;
  try {
    outcome = await db.transaction().execute(async (trx): Promise<Outcome> => {
      if (!(await lockEditableVersion(trx, listingId, versionId))) return { error: stateError(), cleanup: true };
      const fresh = await trx.selectFrom("photo_uploads").select("id").where("id", "=", upload.id).where("registered_at", "is", null).forUpdate().executeTakeFirst();
      if (!fresh) return { error: uploadNotFound(), cleanup: false };
      await sql`select pg_advisory_xact_lock(${QUOTA_LOCK})`.execute(trx);
      const usage = await versionUsage(trx, versionId);
      if (usage.count >= MAX_PHOTOS_PER_VERSION) return { error: limitError(), cleanup: true };
      if (usage.bytes + file.size > MAX_BYTES_PER_VERSION) return { error: totalError(), cleanup: true };
      if ((await storageUsed(trx, now, upload.id)) + file.size > config.blobStorageQuotaBytes) return { error: quotaError(), cleanup: true };

      const photo = await trx
        .insertInto("listing_photos")
        .values({ version_id: versionId, blob_pathname: upload.pathname, content_type: upload.content_type, size_bytes: file.size, position: usage.count + 1, uploaded_by: caller.accountId, created_at: now })
        .returning(["id", "blob_pathname", "content_type", "size_bytes", "position"])
        .executeTakeFirstOrThrow();
      await trx.updateTable("photo_uploads").set({ registered_at: now }).where("id", "=", upload.id).execute();
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: caller.accountId,
          actor_role: actorRole(caller),
          action: PHOTO_ADDED_ACTION,
          entity_type: "listing",
          entity_id: listingId,
          details: JSON.stringify({ versionId, photoId: photo.id, position: photo.position }),
        })
        .execute();
      return { photo };
    });
  } catch (error) {
    const mapped = fromTrigger(error);
    if (mapped) {
      await discard(storage, upload.pathname);
      throw mapped;
    }
    throw error;
  }
  if ("error" in outcome) {
    if (outcome.cleanup) await discard(storage, upload.pathname);
    throw outcome.error;
  }
  return toPhoto(storage, outcome.photo, now);
}

// DELETE .../photos/{photoId}?confirmed=true (removePhoto). Orden: 401, 403 `consent_required`, 403 `forbidden`, 409
// `invalid_state_transition`, 422 (`confirmed`), 404 (la foto no está en esa versión) y 204. Renumera las demás en el mismo orden.
export async function removePhoto(
  db: Db, config: Config, actor: Actor, listingId: string, versionId: string, photoId: string, params: URLSearchParams, now: Date = new Date(), storage: PhotoStorage = getStorage(),
): Promise<void> {
  const caller = await loadCaller(db, config, actor);
  const target = await resolveTarget(db, caller, listingId, versionId);
  if (!isEditable(target)) throw stateError();
  if (params.get("confirmed") !== "true") {
    throw validationFailed([{ field: "confirmed", code: "confirmation_required", message: "Debes confirmar la operación para continuar." }]);
  }
  if (!uuidPattern.test(photoId)) throw photoNotFound();

  const result: { orphan: string | null } = { orphan: null };
  try {
    await db.transaction().execute(async (trx) => {
      if (!(await lockEditableVersion(trx, listingId, versionId))) throw stateError();
      const photo = await trx.selectFrom("listing_photos").select(["id", "blob_pathname", "position"]).where("id", "=", photoId).where("version_id", "=", versionId).executeTakeFirst();
      if (!photo) throw photoNotFound();
      await trx.deleteFrom("listing_photos").where("id", "=", photo.id).execute();
      await sql`set constraints app.listing_photos_version_position_key deferred`.execute(trx);
      await sql`update app.listing_photos set position = position - 1 where version_id = ${versionId} and position > ${photo.position}`.execute(trx);
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: caller.accountId,
          actor_role: actorRole(caller),
          action: PHOTO_REMOVED_ACTION,
          entity_type: "listing",
          entity_id: listingId,
          details: JSON.stringify({ versionId, photoId: photo.id, position: photo.position }),
        })
        .execute();
      // El archivo solo se borra cuando ninguna versión lo usa (ADR 0009).
      const stillUsed = await trx.selectFrom("listing_photos").select("id").where("blob_pathname", "=", photo.blob_pathname).limit(1).executeTakeFirst();
      if (!stillUsed) result.orphan = photo.blob_pathname;
    });
  } catch (error) {
    throw fromTrigger(error) ?? error;
  }
  if (result.orphan) await discard(storage, result.orphan);
}
