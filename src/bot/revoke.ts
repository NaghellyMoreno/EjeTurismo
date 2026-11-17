import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { findActiveRoleGrant, listRoleGrants, revokeRole } from "@/server/services";
import type { Db, RoleGrant } from "@/server/services";
import { send } from "./send";
import { es } from "./texts/es";

// B09: revocar el rol de un administrador o prestador. Sin sesión: todo viaja en `callback_data` (máximo 64 bytes) con la
// acción y el `grantId` (o el número de página); nunca nombre ni ID de Telegram. El rol se lee de la base en cada pulsación.
export const REVOKE_PREFIX = "adm:v";
export const REVOKE_LIST = "adm:vl";
const PAGE = "adm:vp:";
const SELECT = "adm:vs:";
const CONFIRM = "adm:vc:";
const CANCEL = "adm:vx:";

// Permisos por pantalla del bot (D-127).
export const PAGE_SIZE_BOT = 8;

export interface RevokeDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_NUMBER = /^[1-9][0-9]{0,5}$/;

type Parsed = { action: "list" } | { action: "page"; page: number } | { action: "select" | "confirm" | "cancel"; id: string };

export const isRevokeCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(REVOKE_PREFIX);

// Nulo si la acción es desconocida, sobran o faltan segmentos, el id no es un UUID o pasa de 64 bytes.
export function parseRevokeCallback(data: string): Parsed | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (data === REVOKE_LIST) return { action: "list" };
  if (data.startsWith(PAGE)) {
    const page = data.slice(PAGE.length);
    return PAGE_NUMBER.test(page) ? { action: "page", page: Number(page) } : null;
  }
  const byId: [string, "select" | "confirm" | "cancel"][] = [
    [SELECT, "select"],
    [CONFIRM, "confirm"],
    [CANCEL, "cancel"],
  ];
  for (const [prefix, action] of byId) {
    if (data.startsWith(prefix)) {
      const id = data.slice(prefix.length);
      return UUID.test(id) ? { action, id } : null;
    }
  }
  return null;
}

const whoIs = (grant: RoleGrant) => grant.displayName ?? grant.telegramUserId;

async function showList(ctx: Context, deps: RevokeDeps, actor: Actor, page: number) {
  const result = await listRoleGrants(deps.db(), deps.config(), actor, { page: String(page), pageSize: String(PAGE_SIZE_BOT) });
  const keyboard = new InlineKeyboard();
  for (const grant of result.items) {
    keyboard.text(es.revoke.listItem(whoIs(grant), grant.role, grant.isPrincipal), `${SELECT}${grant.id}`).row();
  }
  if (page * PAGE_SIZE_BOT < result.total) keyboard.text(es.revoke.more, `${PAGE}${page + 1}`);
  await send(ctx, es.revoke.listHeader, keyboard);
}

async function askConfirmation(ctx: Context, deps: RevokeDeps, actor: Actor, id: string) {
  const grant = await findActiveRoleGrant(deps.db(), deps.config(), actor, id);
  if (!grant) return void (await send(ctx, es.revoke.alreadyRevoked));
  const text = grant.role === "admin" ? es.revoke.confirmAdmin(whoIs(grant)) : es.revoke.confirmProvider(whoIs(grant));
  await send(ctx, text, new InlineKeyboard().text(es.admin.confirmButton, `${CONFIRM}${id}`).text(es.admin.cancelButton, `${CANCEL}${id}`));
}

async function confirmRevocation(ctx: Context, deps: RevokeDeps, actor: Actor, id: string) {
  const revoked = await revokeRole(deps.db(), deps.config(), actor, id, { confirmed: true }, deps.now());
  await send(ctx, es.revoke.revoked(whoIs(revoked)));
}

// Traduce el error de un servicio al texto del bot; el detalle técnico solo va al registro (sin datos personales).
async function fail(ctx: Context, error: unknown): Promise<void> {
  if (error instanceof AppError) {
    if (error.code === "forbidden" || error.code === "consent_required") return void (await send(ctx, es.admin.forbidden));
    if (error.code === "not_found") return void (await send(ctx, es.revoke.alreadyRevoked));
    if (error.code === "principal_admin_protected") return void (await send(ctx, es.revoke.principalProtected));
    if (error.code === "last_admin_protected") return void (await send(ctx, es.revoke.lastAdminProtected));
  }
  logError("revoke.callback_failed", error);
  await send(ctx, es.admin.error);
}

// El llamador ya comprobó que la cuenta es administradora; los servicios lo vuelven a verificar contra la base.
// Un `callback_data` mal formado se ignora sin responder nada.
export async function handleRevokeCallback(ctx: Context, deps: RevokeDeps, actor: Actor, data: string): Promise<void> {
  const parsed = parseRevokeCallback(data);
  if (!parsed) return;
  try {
    switch (parsed.action) {
      case "list":
        return await showList(ctx, deps, actor, 1);
      case "page":
        return await showList(ctx, deps, actor, parsed.page);
      case "select":
        return await askConfirmation(ctx, deps, actor, parsed.id);
      case "cancel":
        return void (await send(ctx, es.revoke.cancelled));
      case "confirm":
        return await confirmRevocation(ctx, deps, actor, parsed.id);
    }
  } catch (error) {
    await fail(ctx, error);
  }
}
