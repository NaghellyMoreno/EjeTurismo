import { Kysely, PostgresDialect, WithSchemaPlugin } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

export type { Database } from "./types";

let db: Kysely<Database> | undefined;

// Todas las tablas viven en el esquema `app` (ADR 0006).
export function createDb(connectionString: string): Kysely<Database> {
  const local = connectionString.includes("127.0.0.1") || connectionString.includes("localhost");
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 1, ssl: local ? false : true }) }),
    plugins: [new WithSchemaPlugin("app")],
  });
}

// Un cliente por instancia, grupo de tamaño 1, SSL obligatorio (ADR 0012).
export function getDb(): Kysely<Database> {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta DATABASE_URL");
    db = createDb(connectionString);
  }
  return db;
}
