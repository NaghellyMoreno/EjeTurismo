import { z } from "zod";

// El secreto del webhook admite A-Z a-z 0-9 _ - y de 1 a 256 caracteres (Bot API; ADR 0003).
const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
});

export interface Config {
  botToken: string;
  webhookSecret: string;
  databaseUrl: string;
  initDataMaxAgeSeconds: number;
}

// Falla al arrancar si falta una variable obligatoria (fail closed, ADR 0003 y 0006). Nunca repite los valores.
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const input = { ...env };
  if (input.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS === "") delete input.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Configuración inválida: falta o no es válida la variable de entorno ${names}.`);
  }
  const v = parsed.data;
  return {
    botToken: v.TELEGRAM_BOT_TOKEN,
    webhookSecret: v.TELEGRAM_WEBHOOK_SECRET,
    databaseUrl: v.DATABASE_URL,
    initDataMaxAgeSeconds: v.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  return (cached ??= loadConfig());
}
