import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { IDENTITY_DOCUMENT_NAMES } from "@/server/domain/identity";
import { AppError } from "@/server/errors";
import { scheduleDelivery } from "@/server/notifications";
import { logError } from "@/server/observability/logger";
import {
  approveProviderRegistration,
  findProviderRegistration,
  listProviderRegistrations,
  rejectProviderRegistration,
} from "@/server/services";
import type { AdminProviderRegistration, Db, Decision } from "@/server/services";
import { formatBogotaShort } from "@/lib/time";
import { send } from "./send";
import { es } from "./texts/es";

// B06 y B07: revisión de registros de prestadores. Sin sesión ni borrador: todo viaja en `callback_data` (máximo 64 bytes)
// con la acción y el id del registro; nunca nombre, tipo ni número. El rol se verifica en el backend en cada callback.
export const ADMIN_PREFIX = "adm:";
export const LIST_PENDING = "adm:list";
const APPROVE = "adm:a:";
const REJECT = "adm:r:";
const CONFIRM_APPROVE = "adm:ca:";
const CONFIRM_REJECT = "adm:cr:";
const CANCEL = "adm:x:";

// Tope de registros por pulsación (D-096).
export const PENDING_PAGE_SIZE = 10;

export interface AdminDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Parsed =
  | { action: "list" }
  | { action: "approve" | "reject" | "confirmApprove" | "confirmReject" | "cancel"; id: string };

const PREFIXES: [string, Exclude<Parsed, { action: "list" }>["action"]][] = [
  [APPROVE, "approve"],
  [REJECT, "reject"],
  [CONFIRM_APPROVE, "confirmApprove"],
  [CONFIRM_REJECT, "confirmReject"],
  [CANCEL, "cancel"],
];

// Nulo si la acción es desconocida o el id no es un UUID (truncado, mal formado o forjado).
export function parseAdminCallback(data: string): Parsed | null {
  if (data === LIST_PENDING) return { action: "list" };
  for (const [prefix, action] of PREFIXES) {
    if (data.startsWith(prefix)) {
      const id = data.slice(prefix.length);
      return UUID.test(id) ? { action, id } : null;
    }
  }
  return null;
}

export const isAdminCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(ADMIN_PREFIX);

const decisionKeyboard = (id: string) =>
  new InlineKeyboard().text(es.admin.approveButton, `${APPROVE}${id}`).text(es.admin.rejectButton, `${REJECT}${id}`);

const confirmKeyboard = (confirm: string, id: string) =>
  new InlineKeyboard().text(es.admin.confirmButton, `${confirm}${id}`).text(es.admin.cancelButton, `${CANCEL}${id}`);

const detailText = (item: AdminProviderRegistration) =>
  es.admin.registrationDetail({
    telegramUserId: item.telegramUserId,
    displayName: item.telegramDisplayName,
    typeName: IDENTITY_DOCUMENT_NAMES[item.identityDocumentType],
    number: item.identityNumber,
    createdAt: formatBogotaShort(new Date(item.createdAt)),
  });

// Traduce el error de un servicio al texto del bot; el detalle técnico solo va al registro (sin datos personales).
async function fail(ctx: Context, error: unknown): Promise<void> {
  if (error instanceof AppError) {
    if (error.code === "forbidden" || error.code === "consent_required") return void (await send(ctx, es.admin.forbidden));
    if (["not_found", "invalid_state_transition", "role_conflict"].includes(error.code)) {
      return void (await send(ctx, es.admin.alreadyDecided));
    }
  }
  logError("admin.callback_failed", error);
  await send(ctx, es.admin.error);
}

async function showPending(ctx: Context, deps: AdminDeps, actor: Actor) {
  const page = await listProviderRegistrations(deps.db(), deps.config(), actor, {
    status: "pending",
    page: "1",
    pageSize: String(PENDING_PAGE_SIZE),
  });
  if (page.items.length === 0) return void (await send(ctx, es.admin.noPending));
  for (const item of page.items) await send(ctx, detailText(item), decisionKeyboard(item.id));
  if (page.total > page.items.length) await send(ctx, es.admin.morePending);
}

async function askConfirmation(ctx: Context, deps: AdminDeps, actor: Actor, id: string, kind: "approve" | "reject") {
  const found = await findProviderRegistration(deps.db(), deps.config(), actor, id);
  if (!found || found.status !== "pending") return void (await send(ctx, es.admin.alreadyDecided));
  if (kind === "approve") return void (await send(ctx, es.admin.confirmApprove, confirmKeyboard(CONFIRM_APPROVE, id)));
  await send(ctx, es.admin.confirmReject, confirmKeyboard(CONFIRM_REJECT, id));
}

async function decide(ctx: Context, deps: AdminDeps, actor: Actor, id: string, kind: "approve" | "reject") {
  const run = kind === "approve" ? approveProviderRegistration : rejectProviderRegistration;
  const result: Decision = await run(deps.db(), deps.config(), actor, id, { confirmed: true }, deps.now());
  await send(ctx, kind === "approve" ? es.admin.approved : es.admin.rejected);
  // El aviso a la persona sale después de responder (ADR 0007), por la API del bot.
  scheduleDelivery(result.notificationIds, {
    db: deps.db,
    now: deps.now,
    send: (chatId, text) => ctx.api.sendMessage(chatId, text),
  });
}

// El llamador ya comprobó que la cuenta es administradora; los servicios lo vuelven a verificar contra la base.
export async function handleAdminCallback(ctx: Context, deps: AdminDeps, actor: Actor, data: string): Promise<void> {
  const parsed = parseAdminCallback(data);
  if (!parsed) return void (await send(ctx, es.admin.error));
  try {
    switch (parsed.action) {
      case "list":
        return await showPending(ctx, deps, actor);
      case "approve":
        return await askConfirmation(ctx, deps, actor, parsed.id, "approve");
      case "reject":
        return await askConfirmation(ctx, deps, actor, parsed.id, "reject");
      case "cancel":
        return void (await send(ctx, es.admin.cancelled));
      case "confirmApprove":
        return await decide(ctx, deps, actor, parsed.id, "approve");
      case "confirmReject":
        return await decide(ctx, deps, actor, parsed.id, "reject");
    }
  } catch (error) {
    await fail(ctx, error);
  }
}

export const adminKeyboard = () => new InlineKeyboard().text(es.admin.pendingButton, LIST_PENDING);
