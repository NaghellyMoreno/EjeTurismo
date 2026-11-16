import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Extremo a extremo de la Mini App (ADR 0014): `next dev` contra una base temporal propia de esta ejecución, con un
// `Telegram.WebApp` simulado e `initData` firmado con el token de prueba. Todo es ficticio; nunca se lee .env.
// La base se nombra aquí, una sola vez, porque el servidor arranca antes del globalSetup; los procesos hijos heredan el nombre.
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
process.env.E2E_DB_NAME ??= `eje_turismo_e2e_${stamp}_${randomBytes(4).toString("hex")}`;
const migrationsUrl = new URL(process.env.LOCAL_DATABASE_MIGRATIONS_URL ?? "postgresql://postgres@localhost:5432/postgres");
const urlFor = (user?: string) => {
  const url = new URL(migrationsUrl);
  url.pathname = `/${process.env.E2E_DB_NAME}`;
  if (user) url.username = user;
  return url.toString();
};
process.env.TEST_OWNER_URL = urlFor();
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "es-CO", timezoneId: "America/Bogota" },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: urlFor("eje_app"),
      TELEGRAM_BOT_TOKEN: "123456:TEST-bot-token",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      IDENTITY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      IDENTITY_HASH_KEY: Buffer.alloc(32, 9).toString("base64"),
      PRINCIPAL_ADMIN_TELEGRAM_ID: "900000099",
    },
  },
});
