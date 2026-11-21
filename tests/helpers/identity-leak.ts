import type { Pool } from "pg";
import { expect, vi } from "vitest";
import { approveProviderRegistrationHandler, createProviderRegistrationHandler } from "@/server/http/handlers";
import { createAccount, grantAdmin } from "../factories/accounts";
import { resetDb } from "./db";
import { createRequest, registration } from "./http";
import { flush, makeReviewListingApi } from "./review-listing";
import { decisionRequest, route } from "./review-http";
import type { World } from "./listing-http";

// F027: verificación de que el número de identidad nunca sale por una vía visible al visitante ni a otro prestador.
// Valor canario único N1 = CC + 5550123987 (contracts/F027.md, "Datos de prueba").
export const N1_TYPE = "CC";
export const N1_NUMBER = "5550123987";
export const N1 = `${N1_TYPE}${N1_NUMBER}`;
export const L1_NAME = "Café Mirador de Prueba";
export const P2_NUMBER = "7700112233";

export const IDS = { admin: 900027001, p1: 900027002, p2: 900027003, v: 900027004, v0: 900027099, rateLimited: 900027005 } as const;

const FORBIDDEN_KEYS = /identityNumber|identityDocumentType|identity_number|identity_document_type/i;
const spaced = (value: string, gap: string) => value.split("").join(gap);

// Textos que nunca deben aparecer: N1 (normalizado, en minúsculas, con espacios o puntos intercalados), su sello y su cifrado.
export function plainNeedles(): string[] {
  return [N1_NUMBER, N1, N1.toLowerCase(), `${N1_TYPE} ${N1_NUMBER}`, spaced(N1_NUMBER, " "), spaced(N1_NUMBER, "."), spaced(N1_NUMBER, " .")];
}

// Sello y cifrado del registro de P1 tal como quedaron en la base (hexadecimal y base64).
export async function storedSecrets(owner: Pool): Promise<string[]> {
  const { rows } = await owner.query(
    `select encode(identity_number_hash, 'hex') as h, encode(identity_number_hash, 'base64') as h64,
            encode(identity_number_encrypted, 'hex') as e, encode(identity_number_encrypted, 'base64') as e64
       from app.provider_registrations`,
  );
  const out: string[] = [];
  for (const row of rows) for (const value of [row.h, row.h64, row.e, row.e64] as string[]) out.push(value, value.replace(/=+$/, ""));
  return out.filter((v) => v.length >= 8);
}

// Devuelve las fugas encontradas en un texto ya serializado ("sin identidad", contrato F027).
// `valuesOnly` omite la búsqueda de nombres de clave: un error de validación nombra el campo (`errors[].field`) sin repetir su valor.
export function identityLeaks(text: string, secrets: string[], valuesOnly = false): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const needle of [...plainNeedles(), ...secrets]) if (text.includes(needle) || lower.includes(needle.toLowerCase())) found.push(needle.slice(0, 12));
  if (!valuesOnly && FORBIDDEN_KEYS.test(text)) found.push("clave de identidad");
  return found;
}

export function expectNoIdentity(value: unknown, secrets: string[], label = "", valuesOnly = false): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(identityLeaks(text, secrets, valuesOnly), label).toEqual([]);
}

// Espías de console: capturan todo lo escrito por log, warn, error (e info) para el criterio 15.
export function watchConsole() {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
  }
  return {
    lines,
    clear: () => void (lines.length = 0),
    expectClean: (secrets: string[]) => {
      for (const line of lines) expect(identityLeaks(line, secrets), `console: ${line.slice(0, 80)}`).toEqual([]);
    },
  };
}

export interface IdentityWorld {
  api: ReturnType<typeof makeReviewListingApi>;
  world: World;
  l1: { listingId: string; versionId: string };
  l2: { listingId: string; versionId: string };
  registrationId: string;
  secrets: string[];
}

// Siembra con los flujos reales: P1 y P2 se registran por createProviderRegistration (F002), el administrador los aprueba (F003)
// y cada uno crea, envía y ve publicar una ficha (F013 y F014). V ha aceptado el aviso; V0 no tiene cuenta (sin aviso).
export async function seedIdentityWorld(owner: Pool, api: ReturnType<typeof makeReviewListingApi>, tasks: Array<() => unknown>): Promise<IdentityWorld> {
  await resetDb(owner);
  await createAccount(owner, IDS.admin, "Administrador Ficticio");
  await grantAdmin(owner, IDS.admin);
  for (const id of [IDS.p1, IDS.p2, IDS.v, IDS.rateLimited]) await createAccount(owner, id, `Persona Ficticia ${id}`);
  const create = createProviderRegistrationHandler(api.deps);
  const approve = approveProviderRegistrationHandler(api.deps);
  const register = async (userId: number, number: string) => {
    const res = await create(createRequest(userId, registration(N1_TYPE, number)));
    expect(res.status).toBe(201);
    const registrationId = ((await res.json()) as { id: string }).id;
    const approved = await approve(decisionRequest("approval", registrationId, IDS.admin, { confirmed: true }), route(registrationId));
    expect(approved.status).toBe(200);
    await flush(tasks);
    return registrationId;
  };
  const registrationId = await register(IDS.p1, N1_NUMBER);
  await register(IDS.p2, P2_NUMBER);
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  const world: World = {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    municipalityTwo: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Dos', 'municipio ficticio dos', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    typeOne: await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id"),
    a6Account: "",
    p2pAccount: "",
  };
  const publish = async (name: string, userId: number) => {
    const pending = await api.pending(world, name, userId);
    expect((await api.approve(IDS.admin, pending.versionId)).status).toBe(200);
    await flush(tasks);
    return pending;
  };
  const l1 = await publish(L1_NAME, IDS.p1);
  const l2 = await publish("Hostal Ficticio De Otro Prestador", IDS.p2);
  return { api, world, l1, l2, registrationId, secrets: await storedSecrets(owner) };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- esquema OpenAPI sin tipar */
// Claves permitidas y requeridas de un esquema de api/openapi.yaml (sigue $ref y allOf).
export function schemaKeys(spec: { components: { schemas: Record<string, any> } }, name: string): { properties: Set<string>; required: Set<string> } {
  const properties = new Set<string>();
  const required = new Set<string>();
  const visit = (schema: any) => {
    if (!schema) return;
    if (schema.$ref) return visit(spec.components.schemas[String(schema.$ref).split("/").pop()!]);
    for (const part of schema.allOf ?? []) visit(part);
    for (const key of Object.keys(schema.properties ?? {})) properties.add(key);
    for (const key of schema.required ?? []) required.add(key);
  };
  visit(spec.components.schemas[name]);
  return { properties, required };
}
