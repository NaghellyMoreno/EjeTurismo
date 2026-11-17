import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { dropDatabase } from "../helpers/drop-database";

// Crea la base temporal de extremo a extremo con los mismos scripts de db:* y la borra al terminar (ADR 0014).
const migrationsUrl = new URL(process.env.LOCAL_DATABASE_MIGRATIONS_URL ?? "postgresql://postgres@localhost:5432/postgres");

export default async function globalSetup() {
  const dbName = process.env.E2E_DB_NAME!;
  const run = (script: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync("bash", [`scripts/db/${script}`, ...args], { env: { ...process.env, ...env }, stdio: "pipe" });
  try {
    run("bootstrap.sh", []);
    run("migrate.sh", [dbName]);
    run("seed.sh", [dbName], { SEED_DEMO: "0" });
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    throw new Error(`No se pudo preparar la base de extremo a extremo (¿PostgreSQL 17 local está activo? brew services start postgresql@17).\n${stderr}`);
  }
  return async () => {
    const url = new URL(migrationsUrl);
    url.pathname = "/postgres";
    const admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    try {
      await dropDatabase(admin, dbName);
    } finally {
      await admin.end();
    }
  };
}
