import { type Config, getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import type { Db } from "@/server/services";

// Dependencias de los manejadores HTTP; las pruebas pasan las suyas (base simulada, reloj fijo).
export interface Deps {
  config: () => Config;
  db: () => Db;
  now: () => Date;
  // Remitente de los avisos de la bandeja de salida (ADR 0007); por defecto, la API de Telegram con el token del bot.
  send?: (chatId: string, text: string) => Promise<unknown>;
}

export const defaultDeps: Deps = { config: getConfig, db: getDb, now: () => new Date() };
