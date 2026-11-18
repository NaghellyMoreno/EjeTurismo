import type { Pool } from "pg";
import {
  createListingHandler,
  getManagedListingHandler,
  listManagedListingsHandler,
  listPublishedListingsHandler,
  saveListingDraftHandler,
  submitListingForReviewHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { createAccount, createOldVersionAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { testConfig } from "./config";
import { appDb } from "./db";
import { CONTACT, ESTABLISHMENT_ONE, MAPS_URL } from "./listing-data";
import { seedA6b } from "./provider-denial";
import { ADMIN_TEST, PERSON_IDS, PROVIDER_CONTROL } from "./role-denial";
import { signInitData, tma } from "./telegram";

export * from "./listing-data";
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
export const A6 = PROVIDER_CONTROL; // prestador activo, aviso vigente
export const A6B = 900008002; // prestador con aviso anterior
export const P2P = 900013001; // segundo prestador, sin negocios al empezar
export const ADMIN = ADMIN_TEST;
export const VISITOR = PERSON_IDS.A2; // aviso vigente, sin rol

export interface World {
  municipalityOne: string;
  municipalityTwo: string;
  categoryOne: string;
  typeOne: string;
  a6Account: string;
  p2pAccount: string;
}

// Personas y listas ficticias de F013 con el rol propietario (sin fichas).
export async function seedWorld(owner: Pool): Promise<World> {
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN);
  await createAccount(owner, VISITOR, "Visitante Ficticio");
  await createOldVersionAccount(owner, PERSON_IDS.A3);
  const a6Account = await makeProvider(owner, A6, "9000070310");
  await seedA6b(owner);
  const p2pAccount = await makeProvider(owner, P2P, "9000130010");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  return {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    municipalityTwo: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Dos', 'municipio ficticio dos', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    typeOne: await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id"),
    a6Account,
    p2pAccount,
  };
}

// Contenido válido de establecimiento; un valor `undefined` quita la propiedad.
export function fullContent(world: World, content: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    name: ESTABLISHMENT_ONE,
    municipalityId: world.municipalityOne,
    categoryId: world.categoryOne,
    establishmentTypeId: world.typeOne,
    description: "Descripción ficticia.",
    schedule: "Todos los días de 8:00 a 17:00",
    contact: CONTACT,
    mapsUrl: MAPS_URL,
    ...content,
  };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged;
}

export function createBody(world: World, content: Record<string, unknown> = {}, root: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: "establishment", content: fullContent(world, content), confirmed: true, ...root };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return body;
}

export const minimalContent = (world: World, name: string): Record<string, unknown> => ({ name, municipalityId: world.municipalityOne });
export const draftBody = (world: World, content: Record<string, unknown> = {}, root: Record<string, unknown> = {}): Record<string, unknown> => {
  const body: Record<string, unknown> = { content: fullContent(world, content), confirmed: true, ...root };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return body;
};
export const SUBMIT_BODY = { confirmed: true, thirdPartyAuthorizationDeclared: true };

export function makeListingApi(db = appDb()) {
  const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
  const create = createListingHandler(deps);
  const list = listManagedListingsHandler(deps);
  const get = getManagedListingHandler(deps);
  const save = saveListingDraftHandler(deps);
  const submit = submitListingForReviewHandler(deps);
  const published = listPublishedListingsHandler(deps);
  const headersOf = (userId: number | null, extra?: Record<string, string>) => extra ?? (userId === null ? {} : tma(signInitData({ userId })));
  const json = (method: string, url: string, userId: number | null, body: unknown, extra?: Record<string, string>) =>
    new Request(url, { method, headers: { "Content-Type": "application/json", ...headersOf(userId, extra) }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const ctx = (listingId: string) => ({ params: Promise.resolve({ listingId }) });
  const base = "http://localhost/api/v1/managed-listings";
  return {
    db,
    deps,
    create: (userId: number | null, body: unknown, extra?: Record<string, string>) => create(json("POST", base, userId, body, extra)),
    list: (userId: number | null, query = "", extra?: Record<string, string>) => list(new Request(`${base}${query ? `?${query}` : ""}`, { headers: headersOf(userId, extra) })),
    get: (userId: number | null, id: string, extra?: Record<string, string>) => get(new Request(`${base}/${id}`, { headers: headersOf(userId, extra) }), ctx(id)),
    save: (userId: number | null, id: string, body: unknown, extra?: Record<string, string>) => save(json("PUT", `${base}/${id}/draft`, userId, body, extra), ctx(id)),
    submit: (userId: number | null, id: string, body: unknown, extra?: Record<string, string>) => submit(json("POST", `${base}/${id}/submission`, userId, body, extra), ctx(id)),
    published: (userId: number | null, query = "") => published(new Request(`http://localhost/api/v1/public/listings${query ? `?${query}` : ""}`, { headers: headersOf(userId) })),
    destroy: () => db.destroy(),
  };
}
