import { describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import { createWebhookHandler } from "@/bot/webhook";

function setup() {
  const handleUpdate = vi.fn(async () => undefined);
  const botFactory = vi.fn(async () => ({ handleUpdate }) as unknown as Bot);
  const handler = createWebhookHandler({ secret: () => "test-webhook-secret", bot: botFactory });
  const call = (body: string, headers: Record<string, string> = {}) =>
    handler(new Request("http://localhost/api/v1/telegram/webhook", { method: "POST", body, headers }));
  return { call, handleUpdate, botFactory };
}
const secret = { "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret" };

describe("webhook: secreto (criterio 29; ADR 0003)", () => {
  it("responde 401 sin la cabecera o con una distinta, sin invocar al bot", async () => {
    const { call, botFactory, handleUpdate } = setup();
    const body = JSON.stringify({ update_id: 1 });
    const wrong: Record<string, string>[] = [{}, { "X-Telegram-Bot-Api-Secret-Token": "otro" }, { "X-Telegram-Bot-Api-Secret-Token": "" }];
    for (const headers of wrong) {
      const res = await call(body, headers);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
    }
    expect(botFactory).not.toHaveBeenCalled();
    expect(handleUpdate).not.toHaveBeenCalled();
  });
  it("con el secreto correcto entrega la actualización al bot y responde 200", async () => {
    const { call, handleUpdate } = setup();
    expect((await call(JSON.stringify({ update_id: 7, message: {} }), secret)).status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledOnce();
  });
  it("si falta la configuración responde 500 sin invocar al bot", async () => {
    const botFactory = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createWebhookHandler({ secret: () => { throw new Error("falta"); }, bot: botFactory });
    expect((await handler(new Request("http://localhost/x", { method: "POST", body: "{}", headers: secret }))).status).toBe(500);
    expect(botFactory).not.toHaveBeenCalled();
  });

  it("registra solo el nombre de la variable que falla, nunca su valor", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createWebhookHandler({
      secret: () => {
        throw new Error("Configuración inválida: falta o no es válida la variable de entorno IDENTITY_HASH_KEY, DATABASE_URL.");
      },
      bot: vi.fn(),
    });
    await handler(new Request("http://localhost/x", { method: "POST", body: "{}", headers: secret }));
    const line = JSON.parse(String(spy.mock.calls.at(-1)?.[0]));
    spy.mockRestore();
    expect(line).toEqual({ level: "error", event: "webhook.config_failed", errorName: "Error", variables: ["IDENTITY_HASH_KEY", "DATABASE_URL"] });
  });

  it("no registra nada del mensaje si no es una lista de nombres de variable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createWebhookHandler({ secret: () => { throw new Error("variable de entorno valor-secreto=abc."); }, bot: vi.fn() });
    await handler(new Request("http://localhost/x", { method: "POST", body: "{}", headers: secret }));
    const line = String(spy.mock.calls.at(-1)?.[0]);
    spy.mockRestore();
    expect(line).not.toContain("valor-secreto");
    expect(JSON.parse(line)).not.toHaveProperty("variables");
  });
});

describe("webhook: cuerpos que no sirven (criterio 38)", () => {
  const bodies: Record<string, string> = {
    "no es JSON": "{esto no es json",
    "JSON sin update_id": JSON.stringify({ message: { text: "hola" } }),
    "update_id no numérico": JSON.stringify({ update_id: "1" }),
    "JSON que no es un objeto": "null",
  };
  for (const [name, body] of Object.entries(bodies)) {
    it(`responde 200 y no invoca al bot cuando ${name}`, async () => {
      const { call, botFactory } = setup();
      expect((await call(body, secret)).status).toBe(200);
      expect(botFactory).not.toHaveBeenCalled();
    });
  }
});
