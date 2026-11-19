import type { Pool } from "pg";
import { expect } from "vitest";
import { seedListing } from "./listing-data";
import { createBody, draftBody, SUBMIT_BODY } from "./listing-http";
import { A6, ADMIN, flush, makeReviewListingApi, NAME_ONE, NAME_TWO, seedWorld, type World } from "./review-listing";

type Api = ReturnType<typeof makeReviewListingApi>;

// F022: datos de exploración (contrato, "Datos de exploración"). Municipios MU1 y MU2, categorías CA1 y CA2.
export const ATTRACTION_NAME = "Atractivo Ficticio Uno";
export const FB_NAME = "Borrador Ficticio Explorar";
export const FPEND_NAME = "Pendiente Ficticia Explorar";
export const FREJ_NAME = "Rechazada Ficticia Explorar";
export const FPUBB_NAME = "Publicada Con Edicion Ficticia";
export const FPUBB_NEW_NAME = "Version Nueva En Revision Ficticia";
export const MU1_CA2_NAME = "Ficha Ficticia Uno Dos";
export const MU2_CA1_NAME = "Ficha Ficticia Dos Uno";
export const SPECIAL_NAME = 'Café <b>&"Uno"</b>';

export interface ExploreWorld extends World {
  categoryTwo: string;
  adminAccount: string;
  fb: string;
  fpend: string;
  frej: string;
  fpubB: string;
}

export const explorePublished = [ATTRACTION_NAME, NAME_ONE, NAME_TWO, FPUBB_NAME];

export async function insertMunicipality(owner: Pool, name: string): Promise<string> {
  return (await owner.query("insert into app.municipalities (name, name_normalized, department) values ($1, lower($1), 'Caldas') returning id", [name])).rows[0].id as string;
}

async function publish(api: Api, tasks: Array<() => unknown>, world: World, name: string) {
  const p = await api.pending(world, name, A6);
  expect((await api.approve(ADMIN, p.versionId)).status).toBe(200);
  await flush(tasks);
  return p;
}

// Siembra el mundo de F022 con los manejadores reales de F013 y F014 para las fichas de A6.
export async function seedExplore(owner: Pool, api: Api, tasks: Array<() => unknown>): Promise<ExploreWorld> {
  const world = await seedWorld(owner);
  const categoryTwo = (await owner.query("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Dos', 'categoria ficticia dos') returning id")).rows[0].id as string;
  const adminAccount = (await owner.query("select id from app.accounts where telegram_user_id = $1", [ADMIN])).rows[0].id as string;
  await seedListing(owner, { accountId: adminAccount, kind: "attraction", status: "published", municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: ATTRACTION_NAME });
  await publish(api, tasks, world, NAME_ONE);
  await publish(api, tasks, world, NAME_TWO);
  const pubB = await publish(api, tasks, world, FPUBB_NAME);
  expect((await api.save(A6, pubB.listingId, draftBody(world, { name: FPUBB_NEW_NAME }))).status).toBe(200);
  expect((await api.submit(A6, pubB.listingId, SUBMIT_BODY)).status).toBe(200);
  const fb = (await (await api.create(A6, createBody(world, { name: FB_NAME }))).json()) as { id: string };
  const fpend = await api.pending(world, FPEND_NAME, A6);
  const frej = await api.pending(world, FREJ_NAME, A6);
  expect((await api.reject(ADMIN, frej.versionId)).status).toBe(200);
  await flush(tasks);
  const a6Account = world.a6Account;
  await seedListing(owner, { accountId: a6Account, status: "published", municipalityId: world.municipalityOne, categoryId: categoryTwo, name: MU1_CA2_NAME });
  await seedListing(owner, { accountId: a6Account, status: "published", municipalityId: world.municipalityTwo, categoryId: world.categoryOne, name: MU2_CA1_NAME });
  return { ...world, categoryTwo, adminAccount, fb: fb.id, fpend: fpend.listingId, frej: frej.listingId, fpubB: pubB.listingId };
}
