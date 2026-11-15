import { type Config, loadConfig } from "@/server/config";
import { BOT_TOKEN } from "./telegram";

export const TEST_IDENTITY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
export const TEST_IDENTITY_HASH_KEY = Buffer.alloc(32, 9).toString("base64");
export const TEST_PRINCIPAL_ADMIN_ID = 900000099;

// Configuración de prueba con claves ficticias; `env` reemplaza variables (por ejemplo RATE_LIMITS o el TTL del borrador).
export function testConfig(env: Record<string, string | undefined> = {}): Config {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    DATABASE_URL: "postgresql://x@localhost/db",
    IDENTITY_ENCRYPTION_KEY: TEST_IDENTITY_ENCRYPTION_KEY,
    IDENTITY_HASH_KEY: TEST_IDENTITY_HASH_KEY,
    PRINCIPAL_ADMIN_TELEGRAM_ID: String(TEST_PRINCIPAL_ADMIN_ID),
    ...env,
  });
}

export const rateLimitsEnv = (limit: number) => JSON.stringify({ provider_registration: { limit, windowSeconds: 3600 } });
