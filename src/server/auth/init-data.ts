import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramIdentity {
  telegramUserId: string;
  displayName: string | null;
}

// Valida `Telegram.WebApp.initData` en memoria, sin consultar la base ni guardar nada (ADR 0003, 0006; D-008).
// Devuelve null ante cualquier fallo: firma inválida, usuario ausente o `auth_date` vencido.
export function verifyInitData(
  raw: string,
  botToken: string,
  maxAgeSeconds: number,
  now: Date = new Date(),
): TelegramIdentity | null {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const received = Buffer.from(hash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) return null;
  const ageSeconds = now.getTime() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) return null;

  return parseUser(params.get("user"));
}

function parseUser(json: string | null): TelegramIdentity | null {
  if (!json) return null;
  try {
    const user = JSON.parse(json) as { id?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown };
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { telegramUserId: String(user.id), displayName: displayNameOf(user) };
  } catch {
    return null;
  }
}

export function displayNameOf(user: { first_name?: unknown; last_name?: unknown; username?: unknown }): string | null {
  const full = [user.first_name, user.last_name].filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" ").trim();
  if (full) return full;
  return typeof user.username === "string" && user.username ? user.username : null;
}

// Cabecera `Authorization: tma <initData>`.
export function parseAuthorization(header: string | null): string | null {
  if (!header) return null;
  const match = /^tma\s+(.+)$/s.exec(header.trim());
  return match ? match[1] : null;
}
