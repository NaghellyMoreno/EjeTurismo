// pnpm bot:set-webhook [--drop-pending]
// Registra el webhook del bot y sus comandos en Telegram (ADR 0008). Usa TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET y
// APP_BASE_URL del entorno; no imprime ninguno de los tres. Usar con el bot de desarrollo (D-035) para la prueba manual.
import { BOT_COMMANDS } from "../src/bot/commands.ts";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.env.APP_BASE_URL;
if (!token || !secret || !base) {
  console.error("ERROR: faltan TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET o APP_BASE_URL en el entorno.");
  process.exit(1);
}

async function call(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    console.error(`ERROR: ${method} falló: ${json.description ?? res.status}`);
    process.exit(1);
  }
}

await call("setWebhook", {
  url: `${base.replace(/\/$/, "")}/api/v1/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: process.argv.includes("--drop-pending"),
});
await call("setMyCommands", { commands: BOT_COMMANDS });
console.log("Webhook y comandos registrados.");
