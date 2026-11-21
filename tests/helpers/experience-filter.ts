import type { Pool } from "pg";
import { expect } from "vitest";
import { SUBMIT_BODY } from "./listing-http";
import { CONTACT, MAPS_URL } from "./listing-data";
import { A6, ADMIN, flush, makeReviewListingApi, seedWorld, type World } from "./review-listing";

type Api = ReturnType<typeof makeReviewListingApi>;

// F024: datos de prueba del contrato (sección "Datos de prueba"). Todos ficticios.
export const SABORES_ID = "5a0b0e50-0000-4000-8000-000000000001";
export const NEW_NAME = "Ruta Cambio Nueva";

export interface ExperienceWorld extends World {
  t1: string;
  t2: string;
  t3: string;
  cambio: { listingId: string; versionId: string };
  unpublished: { draft: string; pending: string; rejected: string };
}

async function insertType(owner: Pool, name: string): Promise<string> {
  return (await owner.query("insert into app.experience_types (name, name_normalized) values ($1, lower($1)) returning id", [name])).rows[0].id as string;
}

export const routeContent = (world: World, name: string, experienceTypeId: string, municipalityId = world.municipalityOne) => ({
  name,
  municipalityId,
  categoryId: world.categoryOne,
  experienceTypeId,
  guidesInfo: "Guía ficticio de prueba.",
  description: "Descripción ficticia.",
  schedule: "Sábados de 8:00 a 12:00",
  contact: CONTACT,
  mapsUrl: MAPS_URL,
});

export async function createRoute(api: Api, world: World, name: string, experienceTypeId: string, municipalityId = world.municipalityOne, user = A6) {
  const res = await api.create(user, { kind: "route_experience", content: routeContent(world, name, experienceTypeId, municipalityId), confirmed: true });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export async function submitRoute(api: Api, listingId: string, user = A6): Promise<string> {
  const res = await api.submit(user, listingId, SUBMIT_BODY);
  expect(res.status).toBe(200);
  return ((await res.json()) as { working: { id: string } }).working.id;
}

export async function publishRoute(api: Api, tasks: Array<() => unknown>, world: World, name: string, experienceTypeId: string, municipalityId = world.municipalityOne) {
  const listingId = await createRoute(api, world, name, experienceTypeId, municipalityId);
  const versionId = await submitRoute(api, listingId);
  expect((await api.approve(ADMIN, versionId)).status).toBe(200);
  await flush(tasks);
  return { listingId, versionId };
}

// Siembra M1 y M2 como en el contrato. `bulk` agrega las 11 rutas de paginación "Ruta Prueba 01" a "Ruta Prueba 11" (T2) en M2.
export async function seedExperienceWorld(owner: Pool, api: Api, tasks: Array<() => unknown>, bulk = false): Promise<ExperienceWorld> {
  const world = await seedWorld(owner);
  const t1 = await insertType(owner, "Ruta de aventura ficticia");
  const t2 = await insertType(owner, "Ruta cultural ficticia");
  const t3 = await insertType(owner, "Ruta sin fichas ficticia");
  const publish = (name: string, type: string, municipalityId = world.municipalityOne) => publishRoute(api, tasks, world, name, type, municipalityId);

  const hotel = await api.create(A6, { kind: "establishment", content: { name: "Hotel Prueba", municipalityId: world.municipalityOne, categoryId: world.categoryOne, establishmentTypeId: world.typeOne, description: "Descripción ficticia.", schedule: "Todos los días", contact: CONTACT, mapsUrl: MAPS_URL }, confirmed: true });
  const hotelVersion = await submitRoute(api, ((await hotel.json()) as { id: string }).id);
  expect((await api.approve(ADMIN, hotelVersion)).status).toBe(200);
  await publish("Ruta Aventura 01", t1);
  await publish("Ruta Aventura 02", t1);
  const cambio = await publish("Ruta Cambio Publicada", t1);
  await publish("Ruta Cultural 01", t2);
  await publish("Sabores de prueba", SABORES_ID);
  await publish("Ruta Aventura M2", t1, world.municipalityTwo);
  await publish("Ruta Sin Tipo M2", t3, world.municipalityTwo);
  if (bulk) for (let i = 1; i <= 11; i++) await publish(`Ruta Prueba ${String(i).padStart(2, "0")}`, t2, world.municipalityTwo);

  const draft = await createRoute(api, world, "Ruta Borrador", t1);
  const pending = await createRoute(api, world, "Ruta Pendiente", t1);
  await submitRoute(api, pending);
  const rejected = await createRoute(api, world, "Ruta Rechazada", t1);
  expect((await api.reject(ADMIN, await submitRoute(api, rejected))).status).toBe(200);
  await flush(tasks);

  // Versión nueva pendiente de "Ruta Cambio Publicada" con otro nombre y el tipo T2.
  const saved = await api.save(A6, cambio.listingId, { content: routeContent(world, NEW_NAME, t2), confirmed: true });
  expect(saved.status).toBe(200);
  const newVersion = await submitRoute(api, cambio.listingId);
  return { ...world, t1, t2, t3, cambio: { listingId: cambio.listingId, versionId: newVersion }, unpublished: { draft, pending, rejected } };
}
