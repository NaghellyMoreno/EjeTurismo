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
  ensurePrincipalGrant,
  getAccountContext,
  loadBotSession,
  saveBotSession,
} from "@/server/services";
import type { AccountContext, Db } from "@/server/services";
import { adminKeyboard, handleAdminCallback, isAdminCallback } from "../admin";
import { handleAuthorizeUpdate, isAuthCallback, isAuthorizeAdminSession } from "./authorize-admin";
import { isCancelCommand, SessionConflictError } from "../common";
import { handleReviewCallback, handleReviewUpdate, isMyListingsCallback, isReviewCallback, isReviewSession, MY_LISTINGS, showMyListings } from "../review";
import { addSelfRevokeButton, handleSelfRevokeCallback, isSelfRevokeCallback, withSelfRevoke } from "../self-revoke";
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
  return keyboard.text(es.provider.cancelButton, CANCEL);
};

const numberKeyboard = () => new InlineKeyboard().text(es.provider.cancelButton, CANCEL);

const confirmText = (type: IdentityDocumentType) => es.provider.confirm(IDENTITY_DOCUMENT_NAMES[type]);

// Vuelve a mostrar solo el paso en curso, sin cambiar la sesión. En la confirmación avisa que se usan los botones (D-088).
async function repeatStep(ctx: Context, session: Session, invalid: boolean) {
  if (session.step === "type") {
    if (invalid) await send(ctx, es.provider.typeInvalid);
    return send(ctx, es.provider.askType, typeKeyboard());
  }
  if (session.step === "number") {
    if (invalid) await send(ctx, es.provider.numberInvalid);
    return send(ctx, es.provider.askNumber, numberKeyboard());
  }
  await send(ctx, es.common.useButtons);
  return send(ctx, confirmText(session.draft!.identityDocumentType!), confirmKeyboard());
}

const confirmKeyboard = () => new InlineKeyboard().text(es.provider.confirmButton, CONFIRM).text(es.provider.cancelButton, CANCEL);

// B02: el botón de registro solo para cuentas sin rol, sin registro previo o con el último rechazado (D-074, D-115), y que no sean
// el administrador principal.
const canRegister = (info: AccountContext) =>
  info.roles.length === 0 && !info.isPrincipalAdmin && (info.registrationStatus === null || info.registrationStatus === "rejected");

const isAdmin = (info: AccountContext) => info.isPrincipalAdmin || info.roles.includes("admin");

async function showMenu(ctx: Context, info: AccountContext) {
  // B06 mínimo (D-091, D-102): el administrador ve "Registros pendientes" y "Autorizar administrador"; el menú completo es de F005 y siguientes.
  if (isAdmin(info)) return send(ctx, withSelfRevoke(es.menu.welcome), addSelfRevokeButton(adminKeyboard()));
  // Mínimo de B02 para el prestador (D-090, D-091); el menú completo es de F005.
  if (info.roles.includes("provider")) {
    await send(ctx, withSelfRevoke(es.menu.welcome), addSelfRevokeButton(new InlineKeyboard().text(es.menu.myListings, MY_LISTINGS).row()));
    return send(ctx, es.menu.providerAvailable);
  }
  // B05: con el registro pendiente, el estado ocupa el lugar del menú. Se ofrece revocar la autorización (F034 y F035).
  if (info.registrationStatus === "pending") return send(ctx, withSelfRevoke(es.provider.pending), addSelfRevokeButton());
  const keyboard = new InlineKeyboard();
  if (canRegister(info)) keyboard.text(es.menu.registerButton, REGISTER).row();
  return send(ctx, withSelfRevoke(es.menu.welcome), addSelfRevokeButton(keyboard));
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
  const callback = ctx.callbackQuery?.data;
  // D-101: el principal queda reflejado en `role_grants` en su siguiente actualización si falta la fila.
  if (info.isPrincipalAdmin) await ensurePrincipalGrant(db, config, actor.telegramUserId, now);
  // Botones de revisión (B07): el rol de administrador se lee de la base en cada pulsación (ADR 0003), no del botón.
  if (isAdminCallback(callback)) {
    if (!isAdmin(info)) return void (await send(ctx, es.admin.forbidden));
    return handleAdminCallback(ctx, deps, actor, callback);
  }
  // B10 (F014): fichas por revisar. Mismo guardián que los botones de B07; los servicios vuelven a verificar el rol.
  if (isReviewCallback(callback)) {
    if (!isAdmin(info)) return void (await send(ctx, es.admin.forbidden));
    return handleReviewCallback(ctx, deps, actor, accountId, callback);
  }
  // B12 (F014): mis fichas, solo para quien tiene el permiso de prestador.
  if (isMyListingsCallback(callback)) {
    if (!info.roles.includes("provider")) return void (await send(ctx, es.admin.forbidden));
    return showMyListings(ctx, deps, actor);
  }
  // B03: revocar mi autorización. El rol se lee de la base en cada pulsación; el backend aplica la regla por rol (F035).
  if (isSelfRevokeCallback(callback)) return handleSelfRevokeCallback(ctx, deps, actor, info, callback, () => showMenu(ctx, info));
  // B08: botones y mensajes de la autorización de administradores.
  if (isAuthCallback(callback) && !isAdmin(info)) return void (await send(ctx, es.admin.forbidden));
  if (isAdmin(info) && (await handleAuthorizeUpdate(ctx, deps, actor, accountId))) return;
  // B10: el motivo del rechazo y `/cancelar` de una revisión en curso (B08 no reclama una sesión de otro formulario).
  if (isAdmin(info) && callback === undefined && (await handleReviewUpdate(ctx, deps, actor, accountId))) return;
  const cancelling = callback === CANCEL || (callback === undefined && isCancelCommand(ctx));
  if (!canRegister(info)) {
    // Sin formulario posible, cancelar no hace nada y se muestra el menú que le corresponde (D-087).
    if (cancelling) await send(ctx, es.common.nothingToCancel);
    return void (await showMenu(ctx, info));
  }

  const stored = await loadBotSession(db, accountId);
  const session = parseSession(stored?.data);
  // Un administrador revocado con una sesión de B08 abierta: no se crea ningún permiso y se descarta el borrador (F006, criterio 24).
  if (callback !== REGISTER && (isAuthorizeAdminSession(stored?.data) || isReviewSession(stored?.data))) {
    await clearBotSession(db, accountId, now);
    return void (await send(ctx, es.admin.forbidden));
  }
  const save = async (next: Session) => {
    if (!(await saveBotSession(db, accountId, next, stored?.updatedAt ?? null, now))) throw new SessionConflictError();
  };
  const isMessage = callback === undefined && ctx.message !== undefined;
  const hasText = isMessage && ctx.message?.text !== undefined;
  const text = ctx.message?.text ?? "";

  if (callback === REGISTER) {
    await save({ form: FORM, step: "type", draft: {}, startedAt: now.toISOString(), expiresAt: null });
    return void (await send(ctx, es.provider.askType, typeKeyboard()));
  }

  if (cancelling) {
    if (session.step) {
      await clearBotSession(db, accountId, now);
      await send(ctx, es.provider.cancelled);
    } else {
      await send(ctx, es.common.nothingToCancel);
    }
    return void (await showMenu(ctx, info));
  }

  if (callback === CONFIRM) {
    if (!session.step) return void (await send(ctx, es.provider.noDraft));
    const type = session.draft?.identityDocumentType;
    const sealed = session.draft?.sealedIdentity;
    if (session.step !== "confirm") return void (await repeatStep(ctx, session, false));
    if (!type || !sealed) return void (await send(ctx, es.provider.noDraft));
    return confirm(ctx, deps, actor, accountId, { session, type, sealed, save, info });
  }

  if (session.step === "type" && (isIdentityDocumentType(callback) || hasText)) {
    const type = isIdentityDocumentType(callback) ? callback : parseTypeInsensitive(text);
    if (!type) return void (await repeatStep(ctx, session, true));
    await save({ ...session, step: "number", draft: { identityDocumentType: type } });
    return void (await send(ctx, es.provider.askNumber, numberKeyboard()));
  }

  if (session.step === "number" && hasText) {
    const type = session.draft?.identityDocumentType;
    if (!type || validateIdentityNumber(type, text).length > 0) return void (await repeatStep(ctx, session, true));
    const expiresAt = new Date(now.getTime() + config.sensitiveDraftTtlSeconds * 1000);
    await save({
      ...session,
      step: "confirm",
      draft: { identityDocumentType: type, sealedIdentity: sealIdentityNumber(config.identityEncryptionKey, accountId, trimIdentityNumber(text)) },
      expiresAt: expiresAt.toISOString(),
    });
    return void (await send(ctx, confirmText(type), confirmKeyboard()));
  }

  // Entrada que el paso no espera (texto o archivo donde van botones, botón de otro paso, mensaje que no es texto):
  // se repite solo el paso en curso y la sesión no cambia.
  if (session.step && (callback !== undefined || isMessage)) {
    if (session.step !== "confirm" || session.draft?.identityDocumentType) {
      return void (await repeatStep(ctx, session, callback === undefined));
    }
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
