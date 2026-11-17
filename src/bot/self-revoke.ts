import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { getSelfRevocationBlock, revokeMyAuthorization } from "@/server/services";
import type { AccountContext, Db } from "@/server/services";
import { AccountGoneError } from "./common";
import { send } from "./send";
import { es } from "./texts/es";

// B02 y B03: revocar mi autorización. Sin sesión: todo viaja en `callback_data` (solo la acción, prefijo propio, nunca nombre,
// ID de Telegram ni número). El rol se lee de la base en cada pulsación; el bot no decide nada (ADR 0003).
export const SELF_REVOKE_PREFIX = "srv:";
export const SELF_REVOKE_ASK = "srv:ask";
export const SELF_REVOKE_CONFIRM = "srv:yes";
export const SELF_REVOKE_CANCEL = "srv:no";

export interface SelfRevokeDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

type Action = "ask" | "confirm" | "cancel";

export const isSelfRevokeCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(SELF_REVOKE_PREFIX);

// Nulo si la acción es desconocida, sobran o faltan segmentos o pasa de 64 bytes.
export function parseSelfRevokeCallback(data: string): Action | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (data === SELF_REVOKE_ASK) return "ask";
  if (data === SELF_REVOKE_CONFIRM) return "confirm";
  if (data === SELF_REVOKE_CANCEL) return "cancel";
  return null;
}

const blockedText = (block: "principal_admin_protected" | "last_admin_protected") =>
  block === "principal_admin_protected" ? es.selfRevoke.principalProtected : es.selfRevoke.lastAdminProtected;

// Confirmación según los roles activos de la cuenta (invariante 8): el texto dice qué se pierde.
function confirmText(info: AccountContext): string {
  const provider = info.roles.includes("provider");
  const admin = info.roles.includes("admin");
  if (provider && admin) return es.selfRevoke.confirmProviderAdmin;
  if (admin) return es.selfRevoke.confirmAdmin;
  if (provider) return es.selfRevoke.confirmProvider;
  return es.selfRevoke.confirm;
}

// Texto de B02 con la frase de D-023 y el botón, para todas las cuentas (F035).
export const withSelfRevoke = (text: string) => `${text}\n\n${es.selfRevoke.note}`;
export const addSelfRevokeButton = (keyboard: InlineKeyboard = new InlineKeyboard()) => keyboard.text(es.selfRevoke.button, SELF_REVOKE_ASK).row();

// El llamador ya comprobó que la cuenta tiene el aviso vigente. `showMenu` vuelve al menú tras cancelar.
export async function handleSelfRevokeCallback(
  ctx: Context,
  deps: SelfRevokeDeps,
  actor: Actor,
  info: AccountContext,
  data: string,
  showMenu: () => Promise<unknown>,
): Promise<void> {
  const action = parseSelfRevokeCallback(data);
  if (!action) return;
  // Con `srv:yes` el backend vuelve a aplicar la regla; con `srv:ask` el bot solo la consulta para explicar el motivo.
  if (action === "ask") {
    const block = await getSelfRevocationBlock(deps.db(), deps.config(), actor);
    if (block) return void (await send(ctx, blockedText(block)));
    const keyboard = new InlineKeyboard().text(es.selfRevoke.confirmButton, SELF_REVOKE_CONFIRM).text(es.selfRevoke.cancelButton, SELF_REVOKE_CANCEL);
    return void (await send(ctx, confirmText(info), keyboard));
  }
  if (action === "cancel") {
    await send(ctx, es.selfRevoke.cancelled);
    await showMenu();
    return;
  }
  try {
    await revokeMyAuthorization(deps.db(), deps.config(), actor, { confirmed: true }, "bot", deps.now());
    await send(ctx, es.selfRevoke.revoked);
  } catch (error) {
    if (error instanceof AppError && (error.code === "principal_admin_protected" || error.code === "last_admin_protected")) {
      return void (await send(ctx, blockedText(error.code)));
    }
    // Confirmación repetida o simultánea: la cuenta ya no existe y se muestra el aviso (D-039).
    if (error instanceof AppError && error.code === "forbidden") throw new AccountGoneError();
    logError("self_revoke.failed", error);
    await send(ctx, es.selfRevoke.error);
  }
}
