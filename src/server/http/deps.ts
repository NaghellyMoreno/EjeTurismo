import { type Config, getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import type { Db } from "@/server/services";

// Dependencias de los manejadores HTTP; las pruebas pasan las suyas (base simulada, reloj fijo).
export interface Deps {
  config: () => Config;
  db: () => Db;
  now: () => Date;
}

export const defaultDeps: Deps = { config: getConfig, db: getDb, now: () => new Date() };
