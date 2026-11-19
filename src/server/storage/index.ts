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
