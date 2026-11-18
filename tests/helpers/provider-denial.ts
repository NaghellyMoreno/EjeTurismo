import type { Pool } from "pg";
import { createOldVersionAccount } from "../factories/accounts";
import { createRegistration } from "../factories/review";
import { PROVIDER_CONTROL, ROLE_DENIAL_OPERATIONS, type RoleFixtures } from "./role-denial";

// F008: un prestador autorizado no ejecuta acciones de administrador (datos ficticios, rango 900008001 en adelante).
export const PROVIDER_A6 = PROVIDER_CONTROL; // 900007031: aviso vigente, registro `approved`, permiso `provider`
export const PROVIDER_A6B = 900008002; // aviso anterior, registro `approved` y permiso `provider`
export const PROVIDER_E2E = 900008011;
export const A6_IDENTITY_NUMBER = "9000070310";
export const A6B_IDENTITY_NUMBER = "9000080020";

// Las operaciones de solo administrador con ruta (hoy 14).
export const adminOnlyOperations = () => ROLE_DENIAL_OPERATIONS.filter((e) => e.hasRoute && e.roles.length === 1 && e.roles[0] === "admin");

// A6b: prestador con permiso activo y aviso de una versión anterior.
export async function seedA6b(owner: Pool): Promise<void> {
  const accountId = await createOldVersionAccount(owner, PROVIDER_A6B);
  const registrationId = await createRegistration(owner, accountId, { status: "approved", number: A6B_IDENTITY_NUMBER });
  await owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [PROVIDER_A6B, registrationId]);
}

// Las 7 formas de callback_data de revisión de fichas (F014, prefijo `rev:`), con el <uuid> de una versión pendiente real.
export const reviewCallbacks = (versionId: string): string[] => [
  "rev:l", `rev:o:${versionId}`, `rev:a:${versionId}`, `rev:r:${versionId}`, `rev:ca:${versionId}`, `rev:cr:${versionId}`, `rev:x:${versionId}`,
];

// Las 21 formas de callback_data de administrador (14 de F003, F006 y F008 y las 7 de revisión de F014), con <uuid> de un
// recurso real (movidas desde F007).
export const adminCallbacks = (fx: RoleFixtures): string[] => {
  const registration = fx.ids.registrationId;
  const grant = fx.ids.grantId;
  return [
    "adm:list", `adm:a:${registration}`, `adm:r:${registration}`, `adm:ca:${registration}`, `adm:cr:${registration}`, `adm:x:${registration}`,
    "adm:vl", "adm:vp:1", `adm:vs:${grant}`, `adm:vc:${grant}`, `adm:vx:${grant}`,
    "auth:start", "auth:confirm:900007099", "auth:cancel",
    ...reviewCallbacks(fx.ids.reviewVersionId),
  ];
};
