import type { Pool } from "pg";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "./accounts";
import { createRegistration, makeProvider } from "./review";

// Fábricas de F006 (contrato, "Datos de prueba"). Todo es ficticio; insertan con el rol propietario.
export const ADMIN_A = 900000071;
export const ADMIN_B = 900000072;
export const PROVIDER_A = 900000073;
export const PROVIDER_B = 900000074;
export const NO_ROLE = 900000075;
export const PENDING = 900000076;
export const OLD_NOTICE = 900000077;
export const ADMIN_NO_ACCOUNT = 900000078;
export const REVOKED_ADMIN = 900000079;
export const PRINCIPAL = PERSON_PRINCIPAL; // 900000099
export const IDENTITY_NUMBER = "900000099";

export const nameOf = (id: number) => `Persona Prueba ${id}`;

export const person = (owner: Pool, id: number) => createAccount(owner, id, nameOf(id));
export const oldNoticePerson = (owner: Pool, id: number) => createOldVersionAccount(owner, id);

export async function admin(owner: Pool, id: number, withAccount = true): Promise<void> {
  if (withAccount) await person(owner, id);
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [id]);
}

export async function principal(owner: Pool, withRow: boolean): Promise<void> {
  await person(owner, PRINCIPAL);
  if (withRow) await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PRINCIPAL]);
}

// Permiso `admin` ya revocado (por ADMIN_A si existe la cuenta).
export async function revokedAdmin(owner: Pool, id: number): Promise<void> {
  await person(owner, id);
  await owner.query("insert into app.role_grants (telegram_user_id, role, revoked_at) values ($1, 'admin', now())", [id]);
}

// Cada prestador lleva su propio número ficticio (el índice único lo exige); el primero usa 900000099, que nunca debe aparecer en una respuesta.
export const provider = (owner: Pool, id: number) => makeProvider(owner, id, id === PROVIDER_A ? IDENTITY_NUMBER : `10${id}`);

export async function pendingPerson(owner: Pool, id: number): Promise<void> {
  await createRegistration(owner, await person(owner, id), { status: "pending", number: "1020304050" });
}

export async function grantId(owner: Pool, telegramUserId: number, role: "admin" | "provider", active = true): Promise<string> {
  const { rows } = await owner.query(
    `select id from app.role_grants where telegram_user_id = $1 and role = $2 and (revoked_at is null) = $3 order by granted_at desc limit 1`,
    [telegramUserId, role, active],
  );
  return rows[0].id;
}

export const UNKNOWN_GRANT = "00000000-0000-4000-8000-000000000000";

// Estado de las tablas que una revocación rechazada no debe tocar: conteo y contenido completo, en orden estable.
export async function snapshot(owner: Pool, tables: string[] = ["role_grants", "audit_events", "notification_outbox"]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of tables) {
    const { rows } = await owner.query(`select coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '') as s from app.${table} t`);
    out[table] = rows[0].s;
  }
  return out;
}
