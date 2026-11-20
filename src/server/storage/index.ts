import { BlobStorage } from "./blob";
import { memoryStorage } from "./memory";
import type { PhotoStorage } from "./types";

export type { PhotoStorage, StoredFile } from "./types";
export { BlobStorage } from "./blob";
export { MemoryStorage, memoryStorage } from "./memory";

let blob: BlobStorage | undefined;

// El doble en memoria solo se activa con `STORAGE_DRIVER=memory` fuera de producción (F020, criterio 39); en producción
// siempre es Vercel Blob, aunque la variable esté puesta.
export function getStorage(env: Record<string, string | undefined> = process.env): PhotoStorage {
  if (env.STORAGE_DRIVER === "memory" && env.NODE_ENV !== "production") return memoryStorage();
  return (blob ??= new BlobStorage());
}

export const isMemoryStorageEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  env.STORAGE_DRIVER === "memory" && env.NODE_ENV !== "production";

// Descarga una foto a partir de su URL firmada de lectura (respaldo del envío de fotos del bot, F023, ADR 0008). Con el doble en memoria
// la lee del propio almacén; con Vercel Blob pide la URL firmada.
export async function downloadPhoto(url: string, env: Record<string, string | undefined> = process.env): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (isMemoryStorageEnabled(env)) {
    const object = memoryStorage().readByToken(new URL(url).pathname.split("/").pop() ?? "");
    if (!object) throw new Error("photo_not_found");
    return object;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("photo_download_failed");
  return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "image/jpeg" };
}
