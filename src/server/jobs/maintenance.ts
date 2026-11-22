import { logError } from "@/server/observability/logger";
import type { Db } from "@/server/services";
import { getStorage, type PhotoStorage } from "@/server/storage";
import type { JobResult } from "./retention";

// Mantenimiento diario (ADR 0007). Alcance de F038 (D-197): borrar de Blob los archivos que ninguna foto referencia
// (por ejemplo, las fotos de las fichas eliminadas el 31 de enero de 2027). Se conservan los de subidas todavía vigentes.
// Un fallo al borrar un archivo no detiene a los demás ni toca la base: el archivo se reintenta en la siguiente ejecución.
export async function runMaintenanceJob(db: Db, now: Date = new Date(), storage: PhotoStorage = getStorage()): Promise<JobResult> {
  const files = await storage.list();
  const referenced = new Set<string>();
  if (files.length > 0) {
    const photos = await db.selectFrom("listing_photos").select("blob_pathname").where("blob_pathname", "in", files).execute();
    for (const photo of photos) referenced.add(photo.blob_pathname);
    const inFlight = await db
      .selectFrom("photo_uploads")
      .select("pathname")
      .where("pathname", "in", files)
      .where("registered_at", "is", null)
      .where("expires_at", ">", now)
      .execute();
    for (const upload of inFlight) referenced.add(upload.pathname);
  }
  let processed = 0;
  for (const pathname of files.filter((file) => !referenced.has(file))) {
    try {
      await storage.delete(pathname);
      processed += 1;
    } catch (error) {
      logError("maintenance.blob_delete_failed", error);
    }
  }
  return { job: "maintenance", ranAt: now.toISOString(), processed, skippedReason: null };
}
