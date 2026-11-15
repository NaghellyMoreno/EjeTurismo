import type { Pool } from "pg";
import { NOTICE_VERSION } from "../helpers/db";

// Fábricas de datos ficticios para F002 (contrato, "Datos de prueba"). Insertan con el rol propietario.
export const PERSON_1 = 900000011; // registra CC "1020304050"
export const PERSON_2 = 900000012; // duplicado de CC
export const PERSON_3 = 900000013; // PA "ab123"
export const PERSON_4 = 900000014; // PA " AB123 " y luego CE con "1020304050"
export const PERSON_NO_ACCOUNT = 900000015;
export const PERSON_OLD_VERSION = 900000016;
export const PERSON_ADMIN = 900000017;
export const PERSON_PRINCIPAL = 900000099;

export const OLD_NOTICE_VERSION = "2026-10-v1";

export async function createAccount(owner: Pool, telegramUserId: number, name = "Persona Prueba"): Promise<string> {
  const { rows } = await owner.query(
    `insert into app.accounts (telegram_user_id, telegram_display_name, consent_notice_version, consent_accepted_at, consent_channel)
     values ($1, $2, $3, now(), 'bot') returning id`,
    [telegramUserId, name, NOTICE_VERSION],
  );
  return rows[0].id;
}

export async function createOldVersionAccount(owner: Pool, telegramUserId: number): Promise<string> {
  await owner.query(
    "insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ($1, 'b', 'd', false) on conflict do nothing",
    [OLD_NOTICE_VERSION],
  );
  const { rows } = await owner.query(
    `insert into app.accounts (telegram_user_id, telegram_display_name, consent_notice_version, consent_accepted_at, consent_channel)
     values ($1, 'Persona Antigua', $2, now(), 'bot') returning id`,
    [telegramUserId, OLD_NOTICE_VERSION],
  );
  return rows[0].id;
}

export async function grantAdmin(owner: Pool, telegramUserId: number): Promise<void> {
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [telegramUserId]);
}

// Registro `approved` más permiso `provider`, como lo dejará F003; solo para probar el guardián.
export async function grantProvider(owner: Pool, accountId: string, telegramUserId: number): Promise<string> {
  const { rows } = await owner.query(
    `insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status)
     values ($1::uuid, 'CC', '\\x00', decode(md5($2::text), 'hex'), 'approved') returning id`,
    [accountId, accountId],
  );
  await owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [
    telegramUserId,
    rows[0].id,
  ]);
  return rows[0].id;
}
