/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listingErrorMessage } from "@/server/domain/listings";
import { ownerPool, resetDb } from "../helpers/db";
import {
  A6, ADMIN, createBody, ESTABLISHMENT_MIN, ESTABLISHMENT_ONE, makeListingApi, minimalContent, P2P, seedListing, seedWorld, SUBMIT_BODY, VISITOR, type World,
} from "../helpers/listing-http";
import { validateSchema } from "../helpers/openapi";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F013, criterios 11 a 15 y 17: enviar la ficha a revisión.
let owner: Pool;
let world: World;
const api = makeListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});

const draftWith = async (content: Record<string, unknown> = {}, userId = A6) => (await body(await api.create(userId, createBody(world, content)))).id as string;

async function expect422(id: string, raw: unknown, label: string) {
  const before = await snapshotAll(owner);
  const res = await api.submit(A6, id, raw);
  const json = await body(res);
  expect(res.status, label).toBe(422);
  expect(res.headers.get("content-type"), label).toContain("application/problem+json");
  expect(changedTables(before, await snapshotAll(owner)), `${label}: tablas que cambiaron`).toEqual([]);
  expect((await rows("select status from app.listing_versions where listing_id = $1", [id]))[0].status, label).toBe("draft");
  return json as { errors: { field: string; code: string; message: string }[]; detail: string };
}

describe("criterio 11: campo obligatorio vacío", () => {
  const FIELDS = ["categoryId", "description", "schedule", "contact", "mapsUrl"] as const;
  it("cada campo faltante da 422 required con su texto, y el borrador mínimo da exactamente 5 errores", async () => {
    for (const field of FIELDS) {
      const id = await draftWith({ name: `Ficha sin ${field}`, [field]: undefined });
      const json = await expect422(id, SUBMIT_BODY, field);
      expect(json.errors, field).toEqual([{ field, code: "required", message: listingErrorMessage(field, "required") }]);
      process.stdout.write(`criterio 11 | ${field} | required\n`);
    }
    const contact = await draftWith({ name: "Ficha sin contacto", contact: undefined });
    expect((await expect422(contact, SUBMIT_BODY, "contact")).errors[0]!.message).toBe("El contacto es obligatorio.");

    const minimal = (await body(await api.create(A6, { kind: "establishment", content: minimalContent(world, ESTABLISHMENT_MIN), confirmed: true }))).id;
    const json = await expect422(minimal, SUBMIT_BODY, "mínimo");
    expect(json.errors.map((e) => [e.field, e.code]).sort()).toEqual([...FIELDS].sort().map((f) => [f, "required"]));
    expect(json.errors).toHaveLength(5);
  });

  it("name y municipalityId no pueden faltar: el contenido guardado ya los trae (los campos de D-003 son 7)", async () => {
    const id = await draftWith();
    expect((await api.submit(A6, id, SUBMIT_BODY)).status).toBe(200);
  });
});

describe("criterio 12: declaración y confirmación", () => {
  it("12 casos de declaración y confirmación faltantes", async () => {
    const id = await draftWith();
    const missing = [undefined, false, "true", null];
    for (const v of missing) {
      const json = await expect422(id, { ...SUBMIT_BODY, thirdPartyAuthorizationDeclared: v }, `declaración ${String(v)}`);
      expect(json.errors).toEqual([{ field: "thirdPartyAuthorizationDeclared", code: "declaration_required", message: "Debes declarar que tienes la autorización de los guías y contactos." }]);
    }
    for (const v of missing) {
      const json = await expect422(id, { ...SUBMIT_BODY, confirmed: v }, `confirmed ${String(v)}`);
      expect(json.errors).toEqual([{ field: "confirmed", code: "confirmation_required", message: "Debes confirmar la operación para continuar." }]);
    }
    const both = await expect422(id, {}, "ambas");
    expect(both.errors.map((e) => e.field).sort()).toEqual(["confirmed", "thirdPartyAuthorizationDeclared"]);
    const incomplete = await draftWith({ name: "Ficha incompleta", contact: undefined });
    const mixed = await expect422(incomplete, { confirmed: true }, "campo y declaración");
    expect(mixed.errors.map((e) => e.field).sort()).toEqual(["contact", "thirdPartyAuthorizationDeclared"]);
    for (const raw of ["{no-json", { ...SUBMIT_BODY, otro: 1 }]) await expect422(id, raw, "cuerpo inválido");
  });
});

describe("criterio 13: envío correcto", () => {
  it("responde 200 con la misma versión en pending, un evento, auditoría y sin notificaciones", async () => {
    const id = await draftWith();
    const versionBefore = (await rows("select id from app.listing_versions"))[0].id;
    const events = (await rows("select count(*)::int as n from app.listing_status_events"))[0].n;
    const res = await api.submit(A6, id, SUBMIT_BODY);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ displayStatus: "pending", hasPublishedVersion: false, working: { status: "pending", id: versionBefore } });
    expect(json.published ?? null).toBeNull();
    expect(Number.isNaN(Date.parse(json.working.submittedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(json.working.thirdPartyDeclaredAt))).toBe(false);
    const version = (await rows("select * from app.listing_versions"))[0];
    expect(version).toMatchObject({ id: versionBefore, status: "pending", submitted_by: world.a6Account });
    expect(version.submitted_at).not.toBeNull();
    expect(version.third_party_declared_at).not.toBeNull();
    expect(await rows("select 1 from app.listing_versions")).toHaveLength(1);
    const added = (await rows("select * from app.listing_status_events order by id")).slice(events);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ from_status: "draft", to_status: "pending", actor_role: "provider", actor_account_id: world.a6Account });
    expect(await rows("select 1 from app.audit_events where action = 'listing.submitted'")).toHaveLength(1);
    expect(await rows("select 1 from app.notification_outbox")).toHaveLength(0);
  });
});

describe("criterio 14: reenvío, simultáneos y duplicado al enviar", () => {
  it("reenviar la pendiente da 409; dos envíos simultáneos dan un 200 y un 409", async () => {
    const id = await draftWith();
    expect((await api.submit(A6, id, SUBMIT_BODY)).status).toBe(200);
    const before = await snapshotAll(owner);
    const again = await api.submit(A6, id, SUBMIT_BODY);
    expect([again.status, (await body(again)).code]).toEqual([409, "invalid_state_transition"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);

    const second = await draftWith({ name: "Ficha simultánea" });
    const events = (await rows("select count(*)::int as n from app.listing_status_events"))[0].n;
    const results = await Promise.all([api.submit(A6, second, SUBMIT_BODY), api.submit(A6, second, SUBMIT_BODY)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await rows("select count(*)::int as n from app.listing_status_events"))[0].n).toBe(events + 1);
  });

  it("el envío nunca da 409 duplicate: la base impide el borrador con nombre reservado y otro municipio sí se envía", async () => {
    await seedListing(owner, { accountId: world.p2pAccount, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: ESTABLISHMENT_ONE, status: "pending" });
    const mine = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha de A6", complete: true });
    // (a) un borrador de otra ficha con el mismo nombre y municipio viola la exclusión (23P01).
    await expect(owner.query("update app.listing_versions set name = $1, name_normalized = 'establecimiento ficticio uno' where id = $2", [ESTABLISHMENT_ONE, mine.versionId])).rejects.toMatchObject({ code: "23P01" });
    // (b) el mismo nombre en otro municipio se envía con 200.
    await owner.query("update app.listing_versions set name = $1, name_normalized = 'establecimiento ficticio uno', municipality_id = $2 where id = $3", [ESTABLISHMENT_ONE, world.municipalityTwo, mine.versionId]);
    const res = await api.submit(A6, mine.listingId, SUBMIT_BODY);
    expect(res.status).toBe(200);
  });
});

describe("criterios 9, 15 y 17: pendiente, administrador y exploración", () => {
  it("15: el administrador ve la pendiente y no el borrador", async () => {
    const id = await draftWith();
    for (const query of ["", "displayStatus=draft"]) expect((await body(await api.list(ADMIN, query))).items, query).toEqual([]);
    const draftGet = await api.get(ADMIN, id);
    expect([draftGet.status, (await body(draftGet)).code]).toEqual([403, "forbidden"]);
    await api.submit(A6, id, SUBMIT_BODY);
    for (const query of ["displayStatus=pending", ""]) {
      const items = (await body(await api.list(ADMIN, query))).items;
      expect(items.map((i: any) => [i.name, i.displayStatus]), query).toEqual([[ESTABLISHMENT_ONE, "pending"]]);
    }
    const pendingGet = await api.get(ADMIN, id);
    expect(pendingGet.status).toBe(200);
    expect(validateSchema("ManagedListing", await body(pendingGet))).toEqual([]);
  });

  it("9 y 17: ni el borrador ni la pendiente son visibles al visitante y no hay versión publicada", async () => {
    const id = await draftWith();
    await api.submit(A6, id, SUBMIT_BODY);
    await draftWith({ name: "Borrador de A6" });
    await draftWith({ name: "Borrador de P2" }, P2P);
    for (const query of ["", `municipalityId=${world.municipalityOne}&categoryId=${world.categoryOne}`, "kind=establishment"]) {
      expect((await body(await api.published(VISITOR, query))).items, query).toEqual([]);
    }
    expect(await rows("select 1 from app.listing_versions where status = 'published'")).toHaveLength(0);
  });
});
