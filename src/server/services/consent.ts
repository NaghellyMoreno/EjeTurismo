import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { ensurePrincipalGrant } from "./principal-grant";
import type { Db } from "./types";

export type Me = components["schemas"]["Me"];
export type Channel = components["schemas"]["ConsentChannel"];

export interface PrivacyNotice {
  version: string;
  bodyMarkdown: string;
  declarationText: string;
  revocationNote: string | null;
  publishedAt: Date;
}

export interface AccountConsent {
  id: string;
  displayName: string | null;
  acceptedVersion: string;
  acceptedAt: Date;
  channel: Channel;
}

export interface ConsentState {
  notice: PrivacyNotice | null;
  account: AccountConsent | null;
  // Verdadero solo si la cuenta aceptó la versión vigente (D-039).
  accepted: boolean;
}

const noticeNotFound = () => new AppError("not_found", 404, "No hay un aviso de privacidad vigente", undefined);

async function readCurrentNotice(db: Db): Promise<PrivacyNotice | null> {
  const row = await db.selectFrom("privacy_notice_versions").selectAll().where("is_current", "=", true).executeTakeFirst();
  return row
    ? {
        version: row.version,
        bodyMarkdown: row.body_markdown,
        declarationText: row.declaration_text,
        revocationNote: row.revocation_note,
        publishedAt: row.published_at,
      }
    : null;
}

// Solo lectura (D-008): no guarda nada.
export async function getCurrentPrivacyNotice(db: Db): Promise<PrivacyNotice> {
  const notice = await readCurrentNotice(db);
  if (!notice) throw noticeNotFound();
  return notice;
}

// Solo lectura. Lo usan el bot, getMe y el guardián de consentimiento.
export async function getConsentState(db: Db, telegramUserId: string): Promise<ConsentState> {
  const notice = await readCurrentNotice(db);
  const row = await db.selectFrom("accounts").selectAll().where("telegram_user_id", "=", telegramUserId).executeTakeFirst();
  const account: AccountConsent | null = row
    ? {
        id: row.id,
        displayName: row.telegram_display_name,
        acceptedVersion: row.consent_notice_version,
        acceptedAt: row.consent_accepted_at,
        channel: row.consent_channel,
      }
    : null;
  return { notice, account, accepted: !!notice && !!account && account.acceptedVersion === notice.version };
}

// Roles activos según la base y la configuración; vacío sin el aviso vigente aceptado (D-039). El principal es administrador
// por la configuración, con o sin fila en `role_grants` (D-101).
async function resolveRoles(db: Db, config: Config | undefined, telegramUserId: string, state: ConsentState): Promise<Me["roles"]> {
  if (!state.accepted) return [];
  const active = await db
    .selectFrom("role_grants")
    .select("role")
    .where("telegram_user_id", "=", telegramUserId)
    .where("revoked_at", "is", null)
    .execute();
  const roles = new Set<Me["roles"][number]>(active.map((r) => r.role));
  if (config?.principalAdminTelegramId === telegramUserId) roles.add("admin");
  return [...roles].sort();
}

export function toMe(telegramUserId: string, state: ConsentState, roles: Me["roles"] = [], isPrincipalAdmin = false): Me {
  if (!state.notice) throw noticeNotFound();
  return {
    telegramUserId,
    displayName: state.account?.displayName ?? null,
    consent: {
      required: !state.accepted,
      currentVersion: state.notice.version,
      acceptedVersion: state.account?.acceptedVersion ?? null,
      acceptedAt: state.account?.acceptedAt.toISOString() ?? null,
      // F001 no tiene roles: solo con cuenta se puede revocar (los casos del administrador llegan con F004).
      canRevoke: !!state.account,
    },
    roles,
    isPrincipalAdmin,
    providerRegistrationStatus: "none",
    // F002 define cuándo se puede registrar como prestador.
    canRegisterAsProvider: false,
  };
}

export async function getMe(db: Db, actor: Actor, config?: Config): Promise<Me> {
  const state = await getConsentState(db, actor.telegramUserId);
  const roles = await resolveRoles(db, config, actor.telegramUserId, state);
  return toMe(actor.telegramUserId, state, roles, state.accepted && config?.principalAdminTelegramId === actor.telegramUserId);
}

export interface AcceptInput {
  noticeVersion: string;
  channel: Channel;
}

// Crea la cuenta y la prueba de aceptación en una sola transacción. Idempotente: si la cuenta ya aceptó esa versión,
// devuelve el mismo estado sin duplicar nada (HU-001; ADR 0005, 0008).
export async function acceptPrivacyNotice(db: Db, actor: Actor, input: AcceptInput, now: Date = new Date(), config?: Config): Promise<Me> {
  await db.transaction().execute(async (trx) => {
    const notice = await getCurrentPrivacyNotice(trx);
    if (input.noticeVersion !== notice.version) {
      throw new AppError("notice_version_outdated", 409, "La versión del aviso ya no es la vigente");
    }
    const saved = await trx
      .insertInto("accounts")
      .values({
        telegram_user_id: actor.telegramUserId,
        telegram_display_name: actor.displayName,
        consent_notice_version: notice.version,
        consent_accepted_at: now,
        consent_channel: input.channel,
      })
      .onConflict((oc) =>
        oc
          .column("telegram_user_id")
          .doUpdateSet((eb) => ({
            telegram_display_name: eb.ref("excluded.telegram_display_name"),
            consent_notice_version: eb.ref("excluded.consent_notice_version"),
            consent_accepted_at: eb.ref("excluded.consent_accepted_at"),
            consent_channel: eb.ref("excluded.consent_channel"),
          }))
          .where("accounts.consent_notice_version", "<>", notice.version),
      )
      .returning("id")
      .executeTakeFirst();
    // Sin fila devuelta: la cuenta ya tenía la versión vigente y no hay nada que registrar.
    if (saved) {
      await trx
        .insertInto("consent_events")
        .values({ event: "accepted", channel: input.channel, notice_version: notice.version, occurred_at: now })
        .execute();
    }
  });
  // D-101: el administrador principal queda reflejado en `role_grants` al aceptar el aviso.
  if (config) await ensurePrincipalGrant(db, config, actor.telegramUserId, now);
  return getMe(db, actor, config);
}

// Idempotencia del webhook, solo para cuentas existentes (ADR 0008). Verdadero si la actualización es nueva.
export async function claimUpdate(db: Db, updateId: number): Promise<boolean> {
  const row = await db
    .insertInto("processed_updates")
    .values({ update_id: updateId })
    .onConflict((oc) => oc.column("update_id").doNothing())
    .returning("update_id")
    .executeTakeFirst();
  return !!row;
}
