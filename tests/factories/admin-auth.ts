import type { Pool } from "pg";
import { createAccount, createOldVersionAccount } from "./accounts";
import { createRegistration, makeProvider } from "./review";

// Fábricas de F004 (contrato, "Datos de prueba"). Todo es ficticio; insertan con el rol propietario.
export const ADMIN_A = 900000051; // administrador con permiso en role_grants
export const PERSON_WITH_ACCOUNT = 900000052; // persona que se autoriza, con cuenta
export const PERSON_NO_ACCOUNT = 900000053; // persona que se autoriza sin cuenta (D-037)
export const ADMIN_B = 900000054; // segundo administrador (concurrencia)
export const NO_ROLE = 900000055;
export const WITH_PENDING = 900000056;
export const WITH_PROVIDER = 900000057;
export const WITH_REJECTED = 900000058;
export const OLD_NOTICE = 900000059;
export const REVOKED_ADMIN = 900000060;
export const NO_ACCOUNT_NO_GRANT = 900000061;
export const OLD_PRINCIPAL = 900000098;

export const NAME = (id: number) => `Persona Prueba ${id}`;

export const account = (owner: Pool, id: number) => createAccount(owner, id, NAME(id));
export const oldNoticeAccount = (owner: Pool, id: number) => createOldVersionAccount(owner, id);

export async function admin(owner: Pool, id: number): Promise<string> {
  const accountId = await account(owner, id);
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [id]);
  return accountId;
}

export async function revokedAdmin(owner: Pool, id: number): Promise<void> {
  await account(owner, id);
  await owner.query("insert into app.role_grants (telegram_user_id, role, revoked_at) values ($1, 'admin', now())", [id]);
}

export async function withRegistration(owner: Pool, id: number, status: "pending" | "rejected"): Promise<void> {
  await createRegistration(owner, await account(owner, id), { status, number: status === "pending" ? "1020304050" : "ab123" });
}

export const provider = (owner: Pool, id: number) => makeProvider(owner, id);

export async function seedAll(owner: Pool): Promise<void> {
  await admin(owner, ADMIN_A);
  await admin(owner, ADMIN_B);
  await account(owner, PERSON_WITH_ACCOUNT);
  await account(owner, NO_ROLE);
  await withRegistration(owner, WITH_PENDING, "pending");
  await provider(owner, WITH_PROVIDER);
  await withRegistration(owner, WITH_REJECTED, "rejected");
  await oldNoticeAccount(owner, OLD_NOTICE);
  await revokedAdmin(owner, REVOKED_ADMIN);
}
