import { z } from "zod";

// Clave de 32 bytes en base64 estándar (D-078): 43 caracteres y un "=".
const base64Key32 = z.string().refine((v) => /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, "base64").length === 32);

const rule = z.strictObject({ limit: z.number().int().positive(), windowSeconds: z.number().int().positive() });

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

// Valores por defecto de docs/03-arquitectura.md; D-077: registro de prestador, 5 por hora. RATE_LIMITS (JSON) los reemplaza por acción.
const DEFAULT_RATE_LIMITS: Record<string, RateLimitRule> = {
  provider_registration: { limit: 5, windowSeconds: 3600 },
};

const rateLimits = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "json" });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), rule));

// El secreto del webhook admite A-Z a-z 0-9 _ - y de 1 a 256 caracteres (Bot API; ADR 0003).
const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  IDENTITY_ENCRYPTION_KEY: base64Key32,
  IDENTITY_HASH_KEY: base64Key32,
  BOT_SENSITIVE_DRAFT_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  RATE_LIMITS: rateLimits.optional(),
  PRINCIPAL_ADMIN_TELEGRAM_ID: z.string().regex(/^[1-9][0-9]{0,18}$/).optional(),
  // Dirección pública de la Mini App; el bot la usa para el botón "Abrir la Mini App" (F014). Sin ella, el botón no se ofrece.
  APP_BASE_URL: z.url().optional(),
});

export interface Config {
  botToken: string;
  webhookSecret: string;
  databaseUrl: string;
  initDataMaxAgeSeconds: number;
  identityEncryptionKey: Buffer;
  identityHashKey: Buffer;
  sensitiveDraftTtlSeconds: number;
  rateLimits: Record<string, RateLimitRule>;
  principalAdminTelegramId: string | null;
  appBaseUrl: string | null;
}

// Falla al arrancar si falta una variable obligatoria (fail closed, ADR 0003 y 0006). Nunca repite los valores.
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const input = { ...env };
  for (const name of ["TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", "BOT_SENSITIVE_DRAFT_TTL_SECONDS", "RATE_LIMITS", "PRINCIPAL_ADMIN_TELEGRAM_ID", "APP_BASE_URL"]) {
    if (input[name] === "") delete input[name];
  }
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
    identityEncryptionKey: Buffer.from(v.IDENTITY_ENCRYPTION_KEY, "base64"),
    identityHashKey: Buffer.from(v.IDENTITY_HASH_KEY, "base64"),
    sensitiveDraftTtlSeconds: v.BOT_SENSITIVE_DRAFT_TTL_SECONDS,
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...(v.RATE_LIMITS ?? {}) },
    principalAdminTelegramId: v.PRINCIPAL_ADMIN_TELEGRAM_ID ?? null,
    appBaseUrl: v.APP_BASE_URL ? v.APP_BASE_URL.replace(/\/+$/, "") : null,
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  return (cached ??= loadConfig());
}
