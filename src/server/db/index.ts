import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

// Tipos generados (kysely-codegen) llegarán con la primera migración real.
// biome-ignore lint: placeholder hasta generar los tipos
export type Database = Record<string, never>;

let db: Kysely<Database> | undefined;

// Un cliente por instancia, grupo de tamaño 1, SSL obligatorio (ADR 0012).
export function getDb(): Kysely<Database> {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta DATABASE_URL");
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString, max: 1, ssl: connectionString.includes("127.0.0.1") || connectionString.includes("localhost") ? false : true }),
      }),
    });
  }
  return db;
}
