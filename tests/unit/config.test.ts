import { describe, expect, it } from "vitest";
import { loadConfig } from "@/server/config";

const valid = { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_WEBHOOK_SECRET: "secreto-1_A", DATABASE_URL: "postgresql://x@localhost/db" };

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
});
