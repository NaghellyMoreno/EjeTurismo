import { type Config, getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import type { Sender } from "@/server/notifications";
import type { Db } from "@/server/services";
import type { PhotoStorage } from "@/server/storage";

// Dependencias de los manejadores HTTP; las pruebas pasan las suyas (base simulada, reloj fijo).
export interface Deps {
  config: () => Config;
  db: () => Db;
  now: () => Date;
  // Remitente de los avisos de la bandeja de salida (ADR 0007); por defecto, la API de Telegram con el token del bot.
  // Almacén de fotografías; por defecto, el que decide `getStorage()` (Vercel Blob, o el doble en memoria con STORAGE_DRIVER=memory).
  storage?: () => PhotoStorage;
  send?: Sender;
  // Secreto de las tareas programadas (`CRON_SECRET`); por defecto, el del entorno. Sin él, las rutas internas niegan todo.
  cronSecret?: () => string | undefined;
}

export const defaultDeps: Deps = { config: getConfig, db: getDb, now: () => new Date() };
