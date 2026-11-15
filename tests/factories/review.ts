import type { Pool } from "pg";
import { encryptIdentityNumber, identityHash } from "@/server/domain/identity";
import { testConfig } from "../helpers/config";
import { createAccount } from "./accounts";

// Fábricas de F003 (contrato, "Datos de prueba"). Todo es ficticio; insertan con el rol propietario.
export const ADMIN_1 = 900000031; // administrador con permiso en role_grants
export const ADMIN_2 = 900000032; // segundo administrador (concurrencia)
export const USER_APPROVE = 900000033; // CC "1020304050"
export const USER_REJECT = 900000034; // PA "ab123"
export const USER_NO_ROLE = 900000035;
export const USER_PENDING = 900000036; // tiene un registro pendiente e intenta decidir el suyo
export const USER_PROVIDER = 900000037; // ya es prestador
export const USER_NO_ACCOUNT = 900000038;
export const USER_OLD_NOTICE = 900000039;
export const USER_CROSS = 900000040; // cruce con admin (criterio 31)

export const NAMES: Record<number, string> = {
  [ADMIN_1]: "Persona Prueba Treinta y Uno",
  [ADMIN_2]: "Persona Prueba Treinta y Dos",
  [USER_APPROVE]: "Persona Prueba Treinta y Tres",
  [USER_REJECT]: "Persona Prueba Treinta y Cuatro",
  [USER_NO_ROLE]: "Persona Prueba Treinta y Cinco",
  [USER_PENDING]: "Persona Prueba Treinta y Seis",
  [USER_PROVIDER]: "Persona Prueba Treinta y Siete",
  [USER_CROSS]: "Persona Prueba Cuarenta",
};

export const NUMBER_1 = "1020304050";
export const NUMBER_2 = "ab123";
export const NUMBER_3 = "9988776655";
export const NUMBER_4 = "5544332211";
export const REASON = "Documento ilegible";

// 2026-11-16T03:30:00Z es 15/11/2026 22:30 en Bogotá: cambia de día respecto de UTC.
export const CREATED_AT = new Date("2026-11-16T03:30:00Z");
export const CREATED_AT_BOGOTA = "15/11/2026 22:30";

export async function namedAccount(owner: Pool, telegramUserId: number): Promise<string> {
  return createAccount(owner, telegramUserId, NAMES[telegramUserId] ?? `Persona Prueba ${telegramUserId}`);
}

export async function grantAdminRole(owner: Pool, telegramUserId: number): Promise<void> {
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [telegramUserId]);
}

export interface PendingOptions {
  type?: "CC" | "CE" | "PPT" | "PA";
  number?: string;
  createdAt?: Date;
  status?: "pending" | "approved" | "rejected";
}

// Registro con el número cifrado como lo deja createProviderRegistration (mismas claves de prueba).
export async function createRegistration(owner: Pool, accountId: string, options: PendingOptions = {}): Promise<string> {
  const config = testConfig();
  const type = options.type ?? "CC";
  const number = options.number ?? NUMBER_1;
  const { rows } = await owner.query(
    `insert into app.provider_registrations
       (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status, created_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      accountId,
      type,
      encryptIdentityNumber(config.identityEncryptionKey, accountId, number),
      identityHash(config.identityHashKey, type, number),
      options.status ?? "pending",
      options.createdAt ?? CREATED_AT,
    ],
  );
  return rows[0].id;
}

// Prestador ya aprobado, con el número cifrado de verdad (el listado lo descifra).
export async function makeProvider(owner: Pool, telegramUserId: number, number = NUMBER_4): Promise<string> {
  const accountId = await namedAccount(owner, telegramUserId);
  const registrationId = await createRegistration(owner, accountId, { status: "approved", number });
  await owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [
    telegramUserId,
    registrationId,
  ]);
  return accountId;
}

// Cuenta y registro pendiente en un paso.
export async function pendingFor(owner: Pool, telegramUserId: number, options: PendingOptions = {}) {
  const accountId = await namedAccount(owner, telegramUserId);
  const registrationId = await createRegistration(owner, accountId, options);
  return { accountId, registrationId };
}
