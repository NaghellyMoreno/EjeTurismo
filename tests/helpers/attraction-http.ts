import type { Pool } from "pg";
import { createListingHandler, listPublishedListingsHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { createAccount } from "../factories/accounts";
import { grantAdminRole } from "../factories/review";
import { testConfig } from "./config";
import { appDb } from "./db";
import { signInitData, tma } from "./telegram";

// Datos ficticios de F012 (contrato, "Datos de prueba"): sin credenciales; el token es el de `tests/helpers/config.ts`.
export const ADMIN = 900012001;
export const ADMIN_TWO = 900012002;
export const VISITOR = 900012003; // aviso vigente, sin rol
export const NAME_ONE = "Atractivo Ficticio Uno";
export const MAPS_URL = "https://maps.app.goo.gl/AbCdEf123";
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

export interface Seed {
  municipalityOne: string;
  municipalityTwo: string;
  categoryOne: string;
  categoryTwo: string;
}

// Cuentas (administrador, segundo administrador y visitante) y las listas ficticias del contrato.
export async function seedAttractions(owner: Pool): Promise<Seed> {
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdminRole(owner, ADMIN);
  await createAccount(owner, ADMIN_TWO, "Administrador Ficticio Dos");
  await grantAdminRole(owner, ADMIN_TWO);
  await createAccount(owner, VISITOR, "Visitante Ficticio");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  return {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    municipalityTwo: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Dos', 'municipio ficticio dos', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    categoryTwo: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Dos', 'categoria ficticia dos') returning id"),
  };
}

// Cuerpo válido de atractivo; `content` reemplaza o quita campos (valor `undefined` quita la propiedad).
export function attractionBody(seed: Seed, content: Record<string, unknown> = {}, root: Record<string, unknown> = {}) {
  const merged: Record<string, unknown> = {
    name: NAME_ONE,
    municipalityId: seed.municipalityOne,
    categoryId: seed.categoryOne,
    description: "Descripción ficticia.",
    schedule: "Todos los días de 8:00 a 17:00",
    contact: "contacto@ejemplo.invalid",
    mapsUrl: MAPS_URL,
    ...content,
  };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  const body: Record<string, unknown> = { kind: "attraction", content: merged, confirmed: true, ...root };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return body;
}

export function makeAttractionApi(db = appDb()) {
  const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
  const create = createListingHandler(deps);
  const list = listPublishedListingsHandler(deps);
  const headersOf = (userId: number | null, extra?: Record<string, string>) => extra ?? (userId === null ? {} : tma(signInitData({ userId })));
  return {
    db,
    deps,
    createAs: (userId: number | null, body: unknown, extra?: Record<string, string>) =>
      create(
        new Request("http://localhost/api/v1/managed-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headersOf(userId, extra) },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
    listAs: (userId: number | null, query = "", extra?: Record<string, string>) =>
      list(new Request(`http://localhost/api/v1/public/listings${query ? `?${query}` : ""}`, { headers: headersOf(userId, extra) })),
    destroy: () => db.destroy(),
  };
}
