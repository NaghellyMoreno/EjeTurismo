import { describe, expect, it } from "vitest";
import { loadConfig } from "@/server/config";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const valid = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_WEBHOOK_SECRET: "secreto-1_A",
  DATABASE_URL: "postgresql://x@localhost/db",
  IDENTITY_ENCRYPTION_KEY: KEY_A,
  IDENTITY_HASH_KEY: KEY_B,
};

describe("configuración (criterio 30; ADR 0003)", () => {
  it("falla con un error claro si falta TELEGRAM_WEBHOOK_SECRET, sin imprimir valores", () => {
    const env: Record<string, string | undefined> = { ...valid, TELEGRAM_WEBHOOK_SECRET: undefined };
    expect(() => loadConfig(env)).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    try {
      loadConfig(env);
    } catch (error) {
      expect(String(error)).not.toContain("123:abc");
    }
  });
  it("falla si el secreto tiene caracteres que Telegram no admite", () => {
    expect(() => loadConfig({ ...valid, TELEGRAM_WEBHOOK_SECRET: "con espacio" })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
  it("falla si faltan el token o la base", () => {
    expect(() => loadConfig({ ...valid, TELEGRAM_BOT_TOKEN: "" })).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadConfig({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
  it("la vigencia de initData es 86400 s por defecto y se puede configurar", () => {
    expect(loadConfig(valid).initDataMaxAgeSeconds).toBe(86400);
    expect(loadConfig({ ...valid, TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: "" }).initDataMaxAgeSeconds).toBe(86400);
    expect(loadConfig({ ...valid, TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: "3600" }).initDataMaxAgeSeconds).toBe(3600);
  });

  // Contrato F002, criterio 39 (D-078).
  describe("claves de identidad (F002, criterio 39)", () => {
    const names = ["IDENTITY_ENCRYPTION_KEY", "IDENTITY_HASH_KEY"] as const;
    for (const name of names) {
      it(`falla si falta ${name}`, () => {
        expect(() => loadConfig({ ...valid, [name]: undefined })).toThrow(new RegExp(name));
        expect(() => loadConfig({ ...valid, [name]: "" })).toThrow(new RegExp(name));
      });
      it(`falla si ${name} no es base64 de exactamente 32 bytes, sin imprimir el valor`, () => {
        const bad = [Buffer.alloc(16, 1).toString("base64"), Buffer.alloc(33, 1).toString("base64"), "no es base64 !!!", "a".repeat(44)];
        for (const value of bad) {
          let message = "";
          try {
            loadConfig({ ...valid, [name]: value });
          } catch (error) {
            message = String(error);
          }
          expect(message).toMatch(new RegExp(name));
          expect(message).not.toContain(value);
        }
      });
    }
    it("decodifica ambas claves a 32 bytes", () => {
      const config = loadConfig(valid);
      expect(config.identityEncryptionKey).toHaveLength(32);
      expect(config.identityHashKey).toHaveLength(32);
    });
    it("el error no incluye el valor de la clave", () => {
      try {
        loadConfig({ ...valid, IDENTITY_HASH_KEY: KEY_B.slice(0, 10) });
      } catch (error) {
        expect(String(error)).not.toContain(KEY_B.slice(0, 10));
        expect(String(error)).not.toContain(KEY_A);
      }
    });
  });

  describe("otros parámetros de F002", () => {
    it("el vencimiento del borrador es 600 s por defecto y se puede configurar", () => {
      expect(loadConfig(valid).sensitiveDraftTtlSeconds).toBe(600);
      expect(loadConfig({ ...valid, BOT_SENSITIVE_DRAFT_TTL_SECONDS: "1" }).sensitiveDraftTtlSeconds).toBe(1);
    });
    it("el límite del registro de prestador es 5 por hora (D-077) y RATE_LIMITS lo reemplaza", () => {
      expect(loadConfig(valid).rateLimits.provider_registration).toEqual({ limit: 5, windowSeconds: 3600 });
      const custom = JSON.stringify({ provider_registration: { limit: 2, windowSeconds: 3600 } });
      expect(loadConfig({ ...valid, RATE_LIMITS: custom }).rateLimits.provider_registration).toEqual({ limit: 2, windowSeconds: 3600 });
      expect(() => loadConfig({ ...valid, RATE_LIMITS: "no es json" })).toThrow(/RATE_LIMITS/);
    });
    it("el administrador principal es opcional y solo admite un ID numérico", () => {
      expect(loadConfig(valid).principalAdminTelegramId).toBeNull();
      expect(loadConfig({ ...valid, PRINCIPAL_ADMIN_TELEGRAM_ID: "900000099" }).principalAdminTelegramId).toBe("900000099");
      expect(() => loadConfig({ ...valid, PRINCIPAL_ADMIN_TELEGRAM_ID: "abc" })).toThrow(/PRINCIPAL_ADMIN_TELEGRAM_ID/);
    });
  });
});
