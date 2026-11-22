import type { Pool } from "pg";
import { createAccount, grantAdmin, grantProvider } from "../factories/accounts";
import { P1, P3, V, V2 } from "./information-request";
import { insertRequest, seedWorld32, type World32 } from "./provider-requests";
import { seedListing } from "./listing-data";

// F033: datos ficticios (contrato, "Datos de prueba"). A = P1 (dueño de LA = L1), B = P3 (dueño de LB), ADM = ADMIN, V autor de RA.
export const ADM2 = 900033001; // administrador que además es prestador de LC
export const VC = 900033002; // visitante que envió RB y RC
export const A = P1;
export const B = P3;

export interface AccessWorld {
  world: World32;
  ra: string; // solicitud de V a LA con canarios
  ra2: string; // solicitud de V2 (autor, además prestador de LD) a LA
  rb: string; // solicitud de VC a LB
  rc: string; // solicitud de VC a LC (negocio de ADM2)
}

export async function seedAccessWorld(owner: Pool): Promise<AccessWorld> {
  const world = await seedWorld32(owner);
  const vc = await createAccount(owner, VC, "Visitante Tres");
  const adm2 = await createAccount(owner, ADM2, "Administradora Prestadora");
  // D-038 impide registrar como prestador a quien ya es administrador; el caso de D-116 (ambos permisos) se alcanza al
  // autorizar como administrador a un prestador existente: primero el permiso de prestador, después el de administrador.
  await grantProvider(owner, adm2, ADM2);
  await grantAdmin(owner, ADM2);
  const lc = await seedListing(owner, { accountId: adm2, municipalityId: world.municipalityId, categoryId: world.categoryId, name: "Negocio Tres de Prueba", status: "published" });
  // V2 (visitante de F030) también es prestador de su propio negocio LD.
  await grantProvider(owner, world.accounts[V2], V2);
  await seedListing(owner, { accountId: world.accounts[V2], municipalityId: world.municipalityId, categoryId: world.categoryId, name: "Negocio Cuatro de Prueba", status: "published" });
  const base = { listingId: world.l1.listingId, businessId: world.l1.businessId };
  const ra = await insertRequest(owner, { ...base, visitorAccountId: world.accounts[V] });
  const ra2 = await insertRequest(owner, { ...base, visitorAccountId: world.accounts[V2], createdAt: new Date("2026-11-21T13:00:00-05:00") });
  const rb = await insertRequest(owner, { listingId: world.l2b.listingId, businessId: world.l2b.businessId, visitorAccountId: vc, name: "Persona Tres", message: "Mensaje para LB", interestDate: "2026-12-01" });
  const rc = await insertRequest(owner, { listingId: lc.listingId, businessId: lc.businessId!, visitorAccountId: vc, name: "Persona Cuatro", message: "Mensaje para LC", interestDate: "2026-12-01" });
  return { world, ra, ra2, rb, rc };
}

// Instantánea completa de las cuatro tablas, para comparar antes y después de los intentos.
export async function snapshot(owner: Pool): Promise<string> {
  const out: unknown[] = [];
  for (const table of ["information_requests", "information_request_replies", "information_request_status_events", "notification_outbox"]) {
    out.push((await owner.query(`select t.* from app.${table} t order by 1`)).rows);
  }
  return JSON.stringify(out);
}
