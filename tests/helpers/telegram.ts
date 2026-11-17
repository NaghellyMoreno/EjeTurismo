import { createHmac } from "node:crypto";

export const BOT_TOKEN = "123456:TEST-bot-token";
export const NEW_USER = 900000001;
export const ACCEPTING_USER = 900000002;
export const OLD_VERSION_USER = 900000003;

export function signInitData(options: {
  userId: number;
  firstName?: string;
  token?: string;
  authDate?: number;
  tamperUserId?: number;
  // F009: parámetros firmados adicionales, `user` o `auth_date` en crudo (null = ausente) y alteración posterior a la firma.
  extra?: Record<string, string>;
  rawUser?: string | null;
  rawAuthDate?: string | null;
  afterSign?: (params: URLSearchParams) => void;
}): string {
  const params = new URLSearchParams({
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: "AAH-test",
    user: JSON.stringify({ id: options.userId, first_name: options.firstName ?? "Persona Prueba", username: "prueba" }),
  });
  if (options.rawUser === null) params.delete("user");
  else if (options.rawUser !== undefined) params.set("user", options.rawUser);
  if (options.rawAuthDate === null) params.delete("auth_date");
  else if (options.rawAuthDate !== undefined) params.set("auth_date", options.rawAuthDate);
  for (const [k, v] of Object.entries(options.extra ?? {})) params.set(k, v);
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(options.token ?? BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheck).digest("hex"));
  if (options.tamperUserId) {
    params.set("user", JSON.stringify({ id: options.tamperUserId, first_name: "Otra" }));
  }
  options.afterSign?.(params);
  return params.toString();
}

export const tma = (initData: string) => ({ Authorization: `tma ${initData}` });

let counter = 1000;
export const nextUpdateId = () => ++counter;

interface UpdateOptions {
  updateId?: number;
  fromId: number;
  chatId?: number;
  firstName?: string;
}

export function textUpdate(text: string, o: UpdateOptions) {
  return {
    update_id: o.updateId ?? nextUpdateId(),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: o.chatId ?? o.fromId, type: "private" as const, first_name: o.firstName ?? "Persona Prueba" },
      from: { id: o.fromId, is_bot: false, first_name: o.firstName ?? "Persona Prueba" },
      text,
    },
  };
}

export function callbackUpdate(data: string, o: UpdateOptions) {
  return {
    update_id: o.updateId ?? nextUpdateId(),
    callback_query: {
      id: `cb-${nextUpdateId()}`,
      chat_instance: "ci",
      from: { id: o.fromId, is_bot: false, first_name: o.firstName ?? "Persona Prueba" },
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: o.chatId ?? o.fromId, type: "private" as const },
        text: "aviso",
      },
      data,
    },
  };
}
