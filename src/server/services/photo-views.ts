import type { components } from "@/shared/api/schema";
import { PHOTO_URL_TTL_MS } from "@/server/domain/photos";
import { getStorage, type PhotoStorage } from "@/server/storage";
import type { Db } from "./types";

type Photo = components["schemas"]["Photo"];

export interface PhotoRow {
  id: string;
  blob_pathname: string;
  content_type: "image/jpeg" | "image/png";
  size_bytes: number;
  position: number;
}

export async function toPhoto(storage: PhotoStorage, row: PhotoRow, now: Date): Promise<Photo> {
  const expiresAt = new Date(now.getTime() + PHOTO_URL_TTL_MS);
  return { id: row.id, url: await storage.createReadUrl(row.blob_pathname, expiresAt), urlExpiresAt: expiresAt.toISOString(), contentType: row.content_type, sizeBytes: row.size_bytes, position: row.position };
}

// Fotos de varias versiones, en orden de posición y con URL firmada de lectura de corta vigencia (ADR 0009).
export async function loadPhotos(db: Db, versionIds: string[], storage: PhotoStorage = getStorage(), now: Date = new Date()): Promise<Map<string, { photos: Photo[]; totalBytes: number }>> {
  const byVersion = new Map<string, { photos: Photo[]; totalBytes: number }>();
  if (versionIds.length === 0) return byVersion;
  const rows = await db
    .selectFrom("listing_photos")
    .select(["id", "version_id", "blob_pathname", "content_type", "size_bytes", "position"])
    .where("version_id", "in", versionIds)
    .orderBy("version_id")
    .orderBy("position")
    .execute();
  for (const row of rows) {
    const entry = byVersion.get(row.version_id) ?? { photos: [], totalBytes: 0 };
    entry.photos.push(await toPhoto(storage, row, now));
    entry.totalBytes += row.size_bytes;
    byVersion.set(row.version_id, entry);
  }
  return byVersion;
}
