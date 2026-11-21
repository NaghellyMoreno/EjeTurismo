import type { Pool } from "pg";
import { createAccount } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { seedListing } from "./listing-data";

// F030: datos ficticios de las solicitudes de información (contrato, "Datos de prueba"). Insertan con el rol propietario.
export const V = 900030001; // visitante con aviso aceptado; nombre de Telegram `Visitante Prueba`
export const V0 = 900030002; // sin cuenta ni aviso
export const V2 = 900030003; // otro visitante (criterio 23)
export const P1 = 900030004; // prestador aprobado dueño de L1
export const P2 = 900030005; // prestador cuyo rol se revoca; su ficha sigue publicada
export const P3 = 900030006; // segundo prestador con aviso vigente
export const ADMIN = 900030007; // administrador con aviso vigente
export const V_OLD = 900030008; // aceptó una versión anterior del aviso

export const V_NAME = "Visitante Prueba";
export const CHANGED_NAME = "Ana de Prueba";
export const MESSAGE = "Consulta de prueba CANARIO-F030-7731";
export const PARTY_SIZE = 3;
export const L1_NAME = "Café Mirador de Prueba";

// Reloj fijo: 21 de noviembre de 2026, 10:00 en Bogotá. Fecha futura y fecha pasada respecto de él, en el formato del bot y de la API.
export const CLOCK = new Date("2026-11-21T15:00:00Z");
export const FUTURE = { bot: "25/12/2026", api: "2026-12-25" };
export const PAST = { bot: "20/11/2026", api: "2026-11-20" };
export const TODAY = { bot: "21/11/2026", api: "2026-11-21" };
// 23:30 en Bogotá del 21 de noviembre: ya es 22 de noviembre en UTC.
export const LATE_CLOCK = new Date("2026-11-22T04:30:00Z");

export interface InfoWorld {
  municipalityId: string;
  categoryId: string;
  l1: { listingId: string; versionId: string; businessId: string };
  a1: { listingId: string };
  l2: { listingId: string; businessId: string }; // ficha publicada de P2 (con rol revocado)
  l3: { listingId: string }; // borrador de P1
  accounts: Record<number, string>;
}

export async function seedInfoWorld(owner: Pool): Promise<InfoWorld> {
  const municipalityId = (await owner.query("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio', 'municipio ficticio', 'Caldas') returning id")).rows[0].id as string;
  const categoryId = (await owner.query("insert into app.categories (name, name_normalized) values ('Categoria Ficticia', 'categoria ficticia') returning id")).rows[0].id as string;
  const accounts: Record<number, string> = {};
  accounts[V] = await createAccount(owner, V, V_NAME);
  accounts[V2] = await createAccount(owner, V2, "Visitante Dos");
  accounts[ADMIN] = await createAccount(owner, ADMIN, "Administrador Prueba");
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [ADMIN]);
  accounts[P1] = await makeProvider(owner, P1, "1030000001");
  accounts[P2] = await makeProvider(owner, P2, "1030000002");
  accounts[P3] = await makeProvider(owner, P3, "1030000003");
  const l1 = await seedListing(owner, { accountId: accounts[P1], municipalityId, categoryId, name: L1_NAME, status: "published" });
  const a1 = await seedListing(owner, { accountId: accounts[ADMIN], kind: "attraction", municipalityId, categoryId, name: "Atractivo Ficticio De Solicitudes", status: "published" });
  const l2 = await seedListing(owner, { accountId: accounts[P2], municipalityId, categoryId, name: "Ficha De Prestador Revocado", status: "published" });
  const l3 = await seedListing(owner, { accountId: accounts[P1], municipalityId, categoryId, name: "Borrador Ficticio De Solicitudes", status: "draft" });
  await revokeProvider(owner, P2);
  return { municipalityId, categoryId, l1: { ...l1, businessId: l1.businessId! }, a1, l2: { listingId: l2.listingId, businessId: l2.businessId! }, l3, accounts };
}

export async function revokeProvider(owner: Pool, telegramUserId: number): Promise<void> {
  await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'provider' and revoked_at is null", [telegramUserId]);
}

export const requestRows = async (owner: Pool) => (await owner.query("select * from app.information_requests order by created_at, id")).rows as Array<Record<string, unknown>>;
export const requestCount = async (owner: Pool) => Number((await owner.query("select count(*) from app.information_requests")).rows[0].count);

export const counterOf = async (owner: Pool, accountId: string): Promise<number> =>
  Number((await owner.query("select coalesce(sum(count), 0) as n from app.rate_limit_counters where account_id = $1 and action = 'information_request'", [accountId])).rows[0].n);

// Términos que ningún mensaje del flujo puede ofrecer (criterio 16). La única frase con "reserva" permitida es la aclaración aprobada.
export const FORBIDDEN = /\b(pago|pagos|pagar|cupo|cupos|disponibilidad|reserva|reservas|reservar)\b/i;
export const APPROVED_PHRASE = "No es una reserva confirmada.";
export const forbiddenIn = (texts: string[]): string[] => texts.filter((text) => FORBIDDEN.test(text.replaceAll(APPROVED_PHRASE, "")));
