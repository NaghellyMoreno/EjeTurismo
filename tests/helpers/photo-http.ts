import { createPhotoUploadHandler, getPublishedListingHandler, registerPhotoHandler, removePhotoHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { memoryStorage } from "@/server/storage";
import { testConfig } from "./config";
import { appDb } from "./db";
import { jpegBytes } from "./photo-data";
import { makeReviewListingApi } from "./review-listing";
import { signInitData, tma } from "./telegram";

export * from "./photo-data";
export const BASE = "http://localhost/api/v1/managed-listings";
export type Ticket = { uploadId: string; uploadUrl: string; method: string; expiresAt: string; maxSizeBytes: number; contentType: string; remainingPhotos: number; remainingBytes: number };

// Manejadores reales de F020 con la base de prueba (rol eje_app), el doble en memoria del almacén y una configuración ajustable
// (por ejemplo, `BLOB_STORAGE_QUOTA_BYTES` reducido para los criterios de cuota).
export function makePhotoApi(env: Record<string, string | undefined> = {}) {
  const db = appDb();
  const config = testConfig(env);
  const storage = memoryStorage();
  const listing = makeReviewListingApi(db, config);
  const deps: Deps = { config: () => config, db: () => db, now: () => new Date(), storage: () => storage };
  const create = createPhotoUploadHandler(deps);
  const register = registerPhotoHandler(deps);
  const remove = removePhotoHandler(deps);
  const detail = getPublishedListingHandler(deps);
  const headersOf = (userId: number | null, extra?: Record<string, string>) => extra ?? (userId === null ? {} : tma(signInitData({ userId })));
  const post = (url: string, userId: number | null, body: unknown, extra?: Record<string, string>) =>
    new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headersOf(userId, extra) }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const ctx = (listingId: string, versionId: string, photoId = "") => ({ params: Promise.resolve({ listingId, versionId, photoId }) });

  const api = {
    ...listing,
    db,
    config,
    storage,
    upload: (userId: number | null, listingId: string, versionId: string, body: unknown, extra?: Record<string, string>) =>
      create(post(`${BASE}/${listingId}/versions/${versionId}/photo-uploads`, userId, body, extra), ctx(listingId, versionId)),
    register: (userId: number | null, listingId: string, versionId: string, body: unknown, extra?: Record<string, string>) =>
      register(post(`${BASE}/${listingId}/versions/${versionId}/photos`, userId, body, extra), ctx(listingId, versionId)),
    remove: (userId: number | null, listingId: string, versionId: string, photoId: string, query = "?confirmed=true", extra?: Record<string, string>) =>
      remove(new Request(`${BASE}/${listingId}/versions/${versionId}/photos/${photoId}${query}`, { method: "DELETE", headers: headersOf(userId, extra) }), ctx(listingId, versionId, photoId)),
    detail: (userId: number | null, listingId: string, extra?: Record<string, string>) =>
      detail(new Request(`http://localhost/api/v1/public/listings/${listingId}`, { headers: headersOf(userId, extra) }), { params: Promise.resolve({ listingId }) }),
    async pathnameOf(uploadId: string): Promise<string> {
      return (await db.selectFrom("photo_uploads").select("pathname").where("id", "=", uploadId).executeTakeFirstOrThrow()).pathname;
    },
    // Los tres pasos de ADR 0009: pedir la URL, subir el archivo al doble y registrarlo. `declared` cambia el tamaño que declara el cliente.
    async flow(userId: number, listingId: string, versionId: string, file: { bytes?: Uint8Array; contentType?: string; declared?: number; fileName?: string } = {}) {
      const bytes = file.bytes ?? jpegBytes();
      const contentType = file.contentType ?? "image/jpeg";
      const created = await api.upload(userId, listingId, versionId, { fileName: file.fileName ?? "foto.jpg", contentType, sizeBytes: file.declared ?? bytes.length });
      if (created.status !== 201) return { created, ticket: undefined, registered: undefined };
      const ticket = (await created.clone().json()) as Ticket;
      storage.put(await api.pathnameOf(ticket.uploadId), bytes, contentType);
      const registered = await api.register(userId, listingId, versionId, { uploadId: ticket.uploadId });
      return { created, ticket, registered };
    },
    // Sube `count` fotos válidas y devuelve el JSON de cada una.
    async many(userId: number, listingId: string, versionId: string, count: number, bytes: Uint8Array = jpegBytes()) {
      const photos: Array<{ id: string; position: number }> = [];
      for (let i = 0; i < count; i++) {
        const { registered } = await api.flow(userId, listingId, versionId, { bytes });
        if (registered?.status !== 201) throw new Error(`subida ${i + 1} falló con ${registered?.status}`);
        photos.push((await registered.json()) as { id: string; position: number });
      }
      return photos;
    },
  };
  return api;
}
