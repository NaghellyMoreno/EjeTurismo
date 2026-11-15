import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import {
  IDENTITY_DOCUMENT_NAMES,
  IDENTITY_DOCUMENT_TYPES,
  type IdentityDocumentType,
  isIdentityDocumentType,
  openSealedIdentity,
  parseTypeInsensitive,
  sealIdentityNumber,
  trimIdentityNumber,
  validateIdentityNumber,
} from "@/server/domain/identity";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import {
  clearBotSession,
  createProviderRegistration,
  getAccountContext,
  loadBotSession,
  saveBotSession,
} from "@/server/services";
import type { AccountContext, Db } from "@/server/services";
import { send } from "../send";
import { es } from "../texts/es";

// Formulario B04 como máquina de estado sobre `bot_sessions` (ADR 0015). El número de identidad solo está en la sesión
// sellado (AES-256-GCM) y con vencimiento; nunca en claro. Nada toca tablas de negocio hasta "Confirmar".
export const REGISTER = "provider:register";
export const CONFIRM = "provider:confirm";
export const CANCEL = "provider:cancel";

const FORM = "provider_registration";

interface Session {
  form?: typeof FORM;
  step?: "type" | "number" | "confirm";
  draft?: { identityDocumentType?: IdentityDocumentType; sealedIdentity?: string };
  startedAt?: string;
  // Solo existe desde que hay un número sellado.
  expiresAt?: string | null;
}

export interface FormDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

function parseSession(data: unknown): Session {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const raw = data as Session;
  if (raw.form !== FORM || !["type", "number", "confirm"].includes(raw.step ?? "")) return {};
  return raw;
}

const typeKeyboard = () => {
  const keyboard = new InlineKeyboard();
  // callback_data es solo el código de la lista; se interpreta únicamente en el paso del tipo.
  for (const code of IDENTITY_DOCUMENT_TYPES) keyboard.text(es.provider.typeButtons[code], code).row();
  return keyboard;
};

const confirmKeyboard = () => new InlineKeyboard().text(es.provider.confirmButton, CONFIRM).text(es.provider.cancelButton, CANCEL);

// B02: el botón de registro solo para cuentas sin rol, sin registro previo y que no sean el administrador principal (D-074).
const canRegister = (info: AccountContext) => info.roles.length === 0 && !info.isPrincipalAdmin && info.registrationStatus === null;

async function showMenu(ctx: Context, info: AccountContext) {
  // B05: con el registro pendiente, el estado ocupa el lugar del menú.
  if (info.registrationStatus === "pending") return send(ctx, es.provider.pending);
  return send(ctx, es.menu.welcome, canRegister(info) ? new InlineKeyboard().text(es.menu.registerButton, REGISTER) : undefined);
}

// B02 (o B05) para una cuenta con el aviso vigente aceptado, según su rol y su registro.
export async function showAccountMenu(ctx: Context, deps: FormDeps, actor: Actor, accountId: string): Promise<void> {
  await showMenu(ctx, await getAccountContext(deps.db(), deps.config(), accountId, actor.telegramUserId));
}

// Atiende la actualización de una cuenta con el aviso vigente aceptado. El actor sale de `from.id`; la sesión, de su cuenta.
export async function handleAccountUpdate(ctx: Context, deps: FormDeps, actor: Actor, accountId: string): Promise<void> {
  const db = deps.db();
  const config = deps.config();
  const now = deps.now();
  const info = await getAccountContext(db, config, accountId, actor.telegramUserId);
  if (!canRegister(info)) return void (await showMenu(ctx, info));

  const stored = await loadBotSession(db, accountId);
  const session = parseSession(stored?.data);
  const save = async (next: Session) => {
    if (!(await saveBotSession(db, accountId, next, stored?.updatedAt ?? null, now))) throw new Error("session_conflict");
  };
  const callback = ctx.callbackQuery?.data;
  const hasText = callback === undefined && ctx.message !== undefined;
  const text = ctx.message?.text ?? "";

  if (callback === REGISTER) {
    await save({ form: FORM, step: "type", draft: {}, startedAt: now.toISOString(), expiresAt: null });
    return void (await send(ctx, es.provider.askType, typeKeyboard()));
  }

  if (callback === CANCEL) {
    await clearBotSession(db, accountId, now);
    await send(ctx, es.provider.cancelled);
    return void (await showMenu(ctx, info));
  }

  if (callback === CONFIRM) {
    const type = session.draft?.identityDocumentType;
    const sealed = session.draft?.sealedIdentity;
    if (session.step !== "confirm" || !type || !sealed) return void (await send(ctx, es.provider.noDraft));
    return confirm(ctx, deps, actor, accountId, { session, type, sealed, save, info });
  }

  if (session.step === "type" && (isIdentityDocumentType(callback) || hasText)) {
    const type = isIdentityDocumentType(callback) ? callback : parseTypeInsensitive(text);
    if (!type) {
      await send(ctx, es.provider.typeInvalid);
      return void (await send(ctx, es.provider.askType, typeKeyboard()));
    }
    await save({ ...session, step: "number", draft: { identityDocumentType: type } });
    return void (await send(ctx, es.provider.askNumber));
  }

  if (session.step === "number" && hasText) {
    const type = session.draft?.identityDocumentType;
    if (!type || validateIdentityNumber(type, text).length > 0) {
      await send(ctx, es.provider.numberInvalid);
      return void (await send(ctx, es.provider.askNumber));
    }
    const expiresAt = new Date(now.getTime() + config.sensitiveDraftTtlSeconds * 1000);
    await save({
      ...session,
      step: "confirm",
      draft: { identityDocumentType: type, sealedIdentity: sealIdentityNumber(config.identityEncryptionKey, accountId, trimIdentityNumber(text)) },
      expiresAt: expiresAt.toISOString(),
    });
    return void (await send(ctx, es.provider.confirm(IDENTITY_DOCUMENT_NAMES[type]), confirmKeyboard()));
  }

  if (session.step === "confirm" && hasText && session.draft?.identityDocumentType) {
    // Entrada inesperada en la confirmación: se vuelve a preguntar (el manejo general es de F028).
    return void (await send(ctx, es.provider.confirm(IDENTITY_DOCUMENT_NAMES[session.draft.identityDocumentType]), confirmKeyboard()));
  }

  await showMenu(ctx, info);
}

interface ConfirmArgs {
  session: Session;
  type: IdentityDocumentType;
  sealed: string;
  save: (next: Session) => Promise<void>;
  info: AccountContext;
}

async function confirm(ctx: Context, deps: FormDeps, actor: Actor, accountId: string, args: ConfirmArgs): Promise<void> {
  const config = deps.config();
  const now = deps.now();
  const { session, type, sealed, save } = args;

  // Vencido o ilegible: el número se descarta y se pide de nuevo (ADR 0015).
  let number: string | null = null;
  const expired = !session.expiresAt || now.getTime() >= new Date(session.expiresAt).getTime();
  if (!expired) {
    try {
      number = openSealedIdentity(config.identityEncryptionKey, accountId, sealed);
    } catch {
      number = null;
    }
  }
  if (number === null) {
    await save({ ...session, step: "number", draft: { identityDocumentType: type }, expiresAt: null });
    await send(ctx, es.provider.expired);
    return void (await send(ctx, es.provider.askNumber));
  }

  try {
    await createProviderRegistration(
      deps.db(),
      config,
      actor,
      { identityDocumentType: type, identityNumber: number, confirmed: true },
      now,
      { clearBotSession: true },
    );
    return void (await send(ctx, es.provider.pending));
  } catch (error) {
    if (error instanceof AppError && error.code === "duplicate") {
      // El duplicado no se reintenta: el número sellado se borra (criterio 19c).
      await clearBotSession(deps.db(), accountId, now);
      return void (await send(ctx, es.provider.duplicate));
    }
    if (error instanceof AppError && error.code === "rate_limited") return void (await send(ctx, es.provider.rateLimited));
    // Cualquier otro fallo conserva el número sellado hasta su vencimiento, para reintentar.
    logError("provider_registration.confirm_failed", error);
    return void (await send(ctx, es.provider.error));
  }
}
