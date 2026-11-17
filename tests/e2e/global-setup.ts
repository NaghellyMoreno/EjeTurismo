import { execFileSync } from "node:child_process";
import { Client } from "pg";

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
      // `with (force)` exige permiso sobre todas las sesiones; `postgres` no es superusuario, pero sí miembro de eje_app,
      // así que cierra las conexiones del servidor de pruebas con pg_terminate_backend y luego borra la base.
      // El servidor puede reconectar entre un paso y otro, por eso se reintenta unas veces.
      for (let attempt = 1; ; attempt++) {
        await admin.query(
          "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and backend_type = 'client backend' and pid <> pg_backend_pid()",
          [dbName],
        );
        try {
          await admin.query(`drop database if exists "${dbName}"`);
          break;
        } catch (error) {
          if (attempt >= 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    } finally {
      await admin.end();
    }
  };
}
