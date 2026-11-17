import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { dropDatabase } from "./drop-database";

// Crea una base temporal por ejecución (ADR 0014), la migra con los mismos scripts de db:* y la borra al terminar.
// Si PostgreSQL local no está disponible, falla con un mensaje claro: nunca se omiten las pruebas de integración en silencio.
const migrationsUrl = new URL(process.env.LOCAL_DATABASE_MIGRATIONS_URL ?? "postgresql://postgres@localhost:5432/postgres");
const urlFor = (db: string, user?: string) => {
  const url = new URL(migrationsUrl);
  url.pathname = `/${db}`;
  if (user) url.username = user;
  return url.toString();
};

let dbName = "";

export async function setup() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  dbName = `eje_turismo_test_${stamp}_${randomBytes(4).toString("hex")}`;
  const run = (script: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync("bash", [`scripts/db/${script}`, ...args], { env: { ...process.env, ...env }, stdio: "pipe" });
  try {
    run("bootstrap.sh", []);
    run("migrate.sh", [dbName]);
    run("seed.sh", [dbName], { SEED_DEMO: "0" });
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    throw new Error(`No se pudo preparar la base de pruebas (¿PostgreSQL 17 local está activo? brew services start postgresql@17).\n${stderr}`);
  }
  process.env.TEST_DB_NAME = dbName;
  process.env.TEST_OWNER_URL = urlFor(dbName);
  process.env.TEST_APP_URL = urlFor(dbName, "eje_app");
}

export async function teardown() {
  if (!dbName) return;
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  try {
    await dropDatabase(admin, dbName);
  } finally {
    await admin.end();
  }
}
