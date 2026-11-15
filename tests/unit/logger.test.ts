import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logError, redact } from "@/server/observability/logger";

afterEach(() => vi.restoreAllMocks());

describe("logger con redacción (criterio 34; ADR 0005)", () => {
  it("redacta initData, textos, identificadores y datos del usuario, incluso anidados", () => {
    const out = redact({
      event: "x",
      initData: "hash=abc",
      Authorization: "tma abc",
      text: "hola",
      update: { message: { from: { id: 900000001 }, text: "secreto" } },
      telegramUserId: "900000001",
      nested: [{ first_name: "Persona" }],
      ok: 1,
    });
    const json = JSON.stringify(out);
    for (const secret of ["hash=abc", "tma abc", "hola", "900000001", "secreto", "Persona"]) expect(json).not.toContain(secret);
    expect(out).toMatchObject({ event: "x", ok: 1 });
  });
  it("logError solo registra nombre y código, no el mensaje del error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("falla", Object.assign(new Error("Key (telegram_user_id)=(900000001) ya existe"), { code: "23505" }));
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain("900000001");
    expect(JSON.parse(line)).toMatchObject({ event: "falla", errorName: "Error", errorCode: "23505" });
  });
  it("log escribe una línea JSON", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", "listo", { text: "no" });
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({ level: "info", event: "listo", text: "[redactado]" });
  });
});
