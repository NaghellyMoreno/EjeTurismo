/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { updateMunicipalityHandler } from "@/server/http/handlers";
import { createOldVersionAccount } from "../factories/accounts";
import { ADMIN, attractionBody, makeAttractionApi, NAME_ONE, seedAttractions, UNKNOWN_ID, VISITOR, MAPS_URL, type Seed } from "../helpers/attraction-http";
import { renameReq, idContext, LISTS, makeCatalogApi } from "../helpers/catalog-http";
import { ownerPool, resetDb } from "../helpers/db";
import { validateSchema } from "../helpers/openapi";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";
import { listingErrorMessage } from "@/server/domain/listings";

// F012, criterios 1 a 3, 6 a 10, 19, 20, 22a, 24 y 29: atractivo del administrador por HTTP, con base real e instantánea.
let owner: Pool;
let seed: Seed;
const api = makeAttractionApi();
const catalogApi = makeCatalogApi(api.db);
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  seed = await seedAttractions(owner);
});

// Una petición que debe rechazarse con 422 sin cambiar ninguna tabla; devuelve el cuerpo del problema.
async function expect422(raw: unknown, label: string) {
  const before = await snapshotAll(owner);
  const res = await api.createAs(ADMIN, raw);
  const json = await body(res);
  expect(res.status, label).toBe(422);
  expect(res.headers.get("content-type"), label).toContain("application/problem+json");
  expect(json.code, label).toBe("validation_failed");
  expect(validateSchema("Problem", json), label).toEqual([]);
  expect(changedTables(before, await snapshotAll(owner)), `${label}: tablas que cambiaron`).toEqual([]);
  return json as { errors: { field: string; code: string; message: string }[]; detail: string };
}

describe("criterio 1: campo faltante", () => {
  const FIELDS = ["name", "municipalityId", "categoryId", "description", "schedule", "contact", "mapsUrl"] as const;
  it("7 campos x formas de faltante: ausente, vacío y solo espacios", async () => {
    const table: Array<{ campo: string; forma: string; code: string }> = [];
    for (const field of FIELDS) {
      const isId = field === "municipalityId" || field === "categoryId";
      const forms: [string, unknown, string][] = [
        ["ausente", undefined, "required"],
        ["vacío", "", "required"],
        ["solo espacios", "   ", isId ? "invalid" : "required"],
      ];
      for (const [form, value, code] of forms) {
        const json = await expect422(attractionBody(seed, { [field]: value }), `${field} / ${form}`);
        expect(json.errors, `${field} / ${form}`).toContainEqual({ field, code, message: listingErrorMessage(field, code) });
        table.push({ campo: field, forma: form, code });
      }
    }
    console.table(table);
    expect(table).toHaveLength(21);
  });

  it("horarios ausente: el error exacto del openapi", async () => {
    const json = await expect422(attractionBody(seed, { schedule: undefined }), "schedule");
    expect(json.errors).toContainEqual({ field: "schedule", code: "required", message: "Los horarios son obligatorios." });
  });

  it("municipalityId o categoryId con un valor que no es UUID dan invalid", async () => {
    for (const field of ["municipalityId", "categoryId"]) {
      for (const value of ["no-uuid", 5, null]) {
        const json = await expect422(attractionBody(seed, { [field]: value }), `${field} / ${String(value)}`);
        expect(json.errors).toContainEqual({ field, code: "invalid", message: listingErrorMessage(field, "invalid") });
      }
    }
  });
});

describe("criterio 2: falta de confirmación", () => {
  for (const [label, value] of [["ausente", undefined], ["false", false], ["texto true", "true"], ["null", null]] as const) {
    it(`confirmed ${label}`, async () => {
      const json = await expect422(attractionBody(seed, {}, { confirmed: value }), label);
      expect(json.errors).toContainEqual({ field: "confirmed", code: "confirmation_required", message: "Debes confirmar la operación para continuar." });
      expect(json.detail).toBe("Debes confirmar la operación para continuar.");
    });
  }
});

describe("criterio 3: casos inválidos", () => {
  const long = (n: number) => "a".repeat(n);
  const cases: Array<[string, () => unknown, string, string]> = [
    ["name 101", () => attractionBody(seed, { name: long(101) }), "name", "too_long"],
    ["description 1501", () => attractionBody(seed, { description: long(1501) }), "description", "too_long"],
    ["schedule 301", () => attractionBody(seed, { schedule: long(301) }), "schedule", "too_long"],
    ["contact 201", () => attractionBody(seed, { contact: long(201) }), "contact", "too_long"],
    ["name solo espacios", () => attractionBody(seed, { name: "     " }), "name", "required"],
    ["mapsUrl otro dominio", () => attractionBody(seed, { mapsUrl: "https://ejemplo.invalid/mapa" }), "mapsUrl", "invalid_maps_url"],
    ["mapsUrl http", () => attractionBody(seed, { mapsUrl: "http://maps.google.com/maps" }), "mapsUrl", "invalid_maps_url"],
    ["mapsUrl con usuario", () => attractionBody(seed, { mapsUrl: "https://usuario:clave@maps.google.com/maps" }), "mapsUrl", "invalid_maps_url"],
    ["mapsUrl javascript", () => attractionBody(seed, { mapsUrl: "javascript:alert(1)" }), "mapsUrl", "invalid_maps_url"],
    ["mapsUrl ftp", () => attractionBody(seed, { mapsUrl: "ftp://maps.google.com/maps" }), "mapsUrl", "invalid_maps_url"],
    ["mapsUrl 2049", () => attractionBody(seed, { mapsUrl: `https://maps.app.goo.gl/${long(2049 - 24)}` }), "mapsUrl", "invalid_maps_url"],
    ["municipio inexistente", () => attractionBody(seed, { municipalityId: UNKNOWN_ID }), "municipalityId", "not_found"],
    ["categoría inexistente", () => attractionBody(seed, { categoryId: UNKNOWN_ID }), "categoryId", "not_found"],
    ["municipio mal formado", () => attractionBody(seed, { municipalityId: "abc" }), "municipalityId", "invalid"],
    ["categoría mal formada", () => attractionBody(seed, { categoryId: "abc" }), "categoryId", "invalid"],
    ["establishmentTypeId", () => attractionBody(seed, { establishmentTypeId: UNKNOWN_ID }), "establishmentTypeId", "not_allowed"],
    ["experienceTypeId", () => attractionBody(seed, { experienceTypeId: UNKNOWN_ID }), "experienceTypeId", "not_allowed"],
    ["guidesInfo", () => attractionBody(seed, { guidesInfo: "Guía" }), "guidesInfo", "not_allowed"],
    ["propiedad desconocida en content", () => attractionBody(seed, { extra: "x" }), "extra", "unknown_field"],
    ["propiedad desconocida en la raíz", () => attractionBody(seed, {}, { otra: 1 }), "otra", "unknown_field"],
    ["kind ausente", () => attractionBody(seed, {}, { kind: undefined }), "kind", "required"],
    ["kind fuera del enum", () => attractionBody(seed, {}, { kind: "otro" }), "kind", "invalid"],
    ["content ausente", () => attractionBody(seed, {}, { content: undefined }), "content", "required"],
    ["cuerpo que no es JSON", () => "{no-json", "body", "invalid_json"],
  ];
  const table: Array<{ caso: string; field: string; code: string }> = [];
  for (const [name, make, field, code] of cases) {
    it(name, async () => {
      const json = await expect422(make(), name);
      expect(json.errors, name).toContainEqual({ field, code, message: listingErrorMessage(field, code) });
      table.push({ caso: name, field, code });
    });
  }

  it("los límites exactos se aceptan con 201 (100, 1500, 300, 200 y 2048)", async () => {
    const mapsUrl = `https://maps.app.goo.gl/${long(2048 - 24)}`;
    const res = await api.createAs(ADMIN, attractionBody(seed, { name: long(100), description: long(1500), schedule: long(300), contact: long(200), mapsUrl }));
    expect(res.status).toBe(201);
  });
});

describe("criterios 6 y 7: registro y publicación sin validación", () => {
  it("201 con un ManagedListing que cumple el esquema", async () => {
    const res = await api.createAs(ADMIN, attractionBody(seed));
    expect(res.status).toBe(201);
    const json = await body(res);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ kind: "attraction", businessId: null, displayStatus: "published", hasPublishedVersion: true, acceptsRequests: false, working: null });
    expect(json.lastRejection ?? null).toBeNull();
    expect(Number.isNaN(Date.parse(json.createdAt))).toBe(false);
    expect(json.published).toMatchObject({ status: "published", versionNumber: 1 });
    expect(json.published.content).toEqual({
      name: NAME_ONE,
      municipality: { id: seed.municipalityOne, name: "Municipio Ficticio Uno" },
      category: { id: seed.categoryOne, name: "Categoria Ficticia Uno" },
      description: "Descripción ficticia.",
      schedule: "Todos los días de 8:00 a 17:00",
      contact: "contacto@ejemplo.invalid",
      mapsUrl: MAPS_URL,
    });
    const munis = await body(await catalogApi.handlers(LISTS[0]).list(new Request("http://localhost/api/v1/categories", { headers: tma(signInitData({ userId: ADMIN })) })) as Response);
    expect(munis.find((c: any) => c.id === seed.categoryOne).name).toBe(json.published.content.category.name);
  });

  it("filas: ficha, versión publicada, evento de estado y auditoría; nada en outbox, fotos ni businesses", async () => {
    const adminId = (await owner.query("select id from app.accounts where telegram_user_id = $1", [ADMIN])).rows[0].id;
    const json = await body(await api.createAs(ADMIN, attractionBody(seed, { name: "  Atractivo   Ficticio Uno " })));
    const listings = (await owner.query("select * from app.listings")).rows;
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({ id: json.id, kind: "attraction", business_id: null, created_by_account_id: adminId });
    const versions = (await owner.query("select * from app.listing_versions")).rows;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ status: "published", version_number: 1, name: "Atractivo   Ficticio Uno", name_normalized: "atractivo ficticio uno", decided_by: adminId });
    expect(versions[0].decided_at).not.toBeNull();
    const events = (await owner.query("select * from app.listing_status_events")).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ to_status: "published", from_status: null, actor_role: "admin", actor_account_id: adminId, listing_id: json.id, version_id: versions[0].id });
    const audit = (await owner.query("select * from app.audit_events")).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "listing.created", entity_type: "listing", entity_id: json.id, actor_role: "admin", actor_account_id: adminId });
    expect(audit[0].details).toEqual({ kind: "attraction", municipalityId: seed.municipalityOne, categoryId: seed.categoryOne });
    expect(await count("notification_outbox")).toBe(0);
    expect(await count("businesses")).toBe(0);
  });
});

describe("criterios 8 a 10: lectura pública", () => {
  it("8: el visitante con aviso vigente ve el atractivo en su municipio y categoría; con otros filtros no", async () => {
    const created = await body(await api.createAs(ADMIN, attractionBody(seed)));
    const res = await api.listAs(VISITOR, `municipalityId=${seed.municipalityOne}&categoryId=${seed.categoryOne}`);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(validateSchema("PublicListingSummaryPage", json)).toEqual([]);
    expect(json.items).toEqual([
      { id: created.id, kind: "attraction", name: NAME_ONE, municipality: { id: seed.municipalityOne, name: "Municipio Ficticio Uno" }, category: { id: seed.categoryOne, name: "Categoria Ficticia Uno" } },
    ]);
    expect(Object.hasOwn(json.items[0], "experienceType")).toBe(false);
    const text = JSON.stringify(json);
    for (const secret of ["identity", "telegram", "account", String(ADMIN), String(VISITOR)]) expect(text).not.toContain(secret);
    for (const query of [`municipalityId=${seed.municipalityTwo}`, `categoryId=${seed.categoryTwo}`, "kind=establishment"]) {
      expect((await body(await api.listAs(VISITOR, query))).items, query).toEqual([]);
    }
    expect((await body(await api.listAs(VISITOR, "kind=attraction"))).items).toHaveLength(1);
  });

  it("9: sin aviso vigente 403 consent_required; sin identidad 401; sin cambios en la base", async () => {
    await createOldVersionAccount(owner, 900012099);
    const before = await snapshotAll(owner);
    for (const user of [900012098, 900012099]) {
      const res = await api.listAs(user);
      expect(res.status, String(user)).toBe(403);
      expect((await body(res)).code).toBe("consent_required");
    }
    expect((await api.listAs(null)).status).toBe(401);
    expect((await api.listAs(null, "", tma(signInitData({ userId: VISITOR, token: "9:otro" })))).status).toBe(401);
    expect((await api.listAs(null, "", tma(signInitData({ userId: VISITOR, authDate: Math.floor(Date.now() / 1000) - 10 * 86400 })))).status).toBe(401);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it("10: solo aparecen versiones published (borrador y rechazada sembradas por SQL no)", async () => {
    await api.createAs(ADMIN, attractionBody(seed));
    const adminId = (await owner.query("select id from app.accounts where telegram_user_id = $1", [ADMIN])).rows[0].id;
    for (const [status, name] of [["draft", "Atractivo Ficticio Borrador"], ["rejected", "Atractivo Ficticio Rechazado"]]) {
      const { rows } = await owner.query("insert into app.listings (kind, created_by_account_id) values ('attraction', $1) returning id", [adminId]);
      await owner.query(
        `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url, rejection_reason)
         values ($1, 1, $2, $3, lower($3), $4, $5, 'd', 's', 'c', $6, case when $2 = 'rejected' then 'Motivo ficticio' end)`,
        [rows[0].id, status, name, seed.municipalityOne, seed.categoryOne, MAPS_URL],
      );
    }
    const json = await body(await api.listAs(VISITOR));
    expect(json.items.map((i: any) => i.name)).toEqual([NAME_ONE]);
    expect(json.total).toBe(1);
  });
});

describe("criterios 19 a 22a: duplicado y mismo nombre en otro municipio", () => {
  it("19: el mismo nombre en el mismo municipio da 409 duplicate, también con espacios, mayúsculas y tildes", async () => {
    expect((await api.createAs(ADMIN, attractionBody(seed))).status).toBe(201);
    for (const name of [NAME_ONE, "  atractivo   ficticio uno ", "ATRACTIVO FICTICIO UNO", "Atractivó Fíctício Uno"]) {
      const before = await snapshotAll(owner);
      const res = await api.createAs(ADMIN, attractionBody(seed, { name }));
      const json = await body(res);
      expect(res.status, name).toBe(409);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(json).toMatchObject({ code: "duplicate", detail: "Ya existe una ficha con ese nombre en ese municipio." });
      expect(validateSchema("Problem", json)).toEqual([]);
      expect(changedTables(before, await snapshotAll(owner)), name).toEqual([]);
    }
  });

  it("20: dos creaciones simultáneas dan un 201 y un 409, con una fila en listings y en listing_versions", async () => {
    const results = await Promise.all([api.createAs(ADMIN, attractionBody(seed)), api.createAs(ADMIN, attractionBody(seed))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count("listings")).toBe(1);
    expect(await count("listing_versions")).toBe(1);
  });

  it("22a: el mismo nombre en otro municipio da 201 y cada municipio devuelve su ficha", async () => {
    expect((await api.createAs(ADMIN, attractionBody(seed))).status).toBe(201);
    expect((await api.createAs(ADMIN, attractionBody(seed, { municipalityId: seed.municipalityTwo }))).status).toBe(201);
    expect((await api.createAs(ADMIN, attractionBody(seed, { name: "Atractivo Ficticio Dos" }))).status).toBe(201);
    const one = await body(await api.listAs(VISITOR, `municipalityId=${seed.municipalityOne}`));
    const two = await body(await api.listAs(VISITOR, `municipalityId=${seed.municipalityTwo}`));
    expect(one.items.map((i: any) => i.name)).toEqual(["Atractivo Ficticio Dos", NAME_ONE]);
    expect(two.items.map((i: any) => i.name)).toEqual([NAME_ONE]);
    expect(one.items[1].id).not.toBe(two.items[0].id);
  });
});

describe("criterio 24: el nombre nuevo aparece en la ficha", () => {
  it("renombrar la categoría y el municipio cambia lo que devuelve la lista; el ID y la versión no cambian", async () => {
    const created = await body(await api.createAs(ADMIN, attractionBody(seed)));
    const versionBefore = (await owner.query("select * from app.listing_versions")).rows[0];
    const renameCategory = await catalogApi.handlers(LISTS[0]).rename(renameReq(LISTS[0], seed.categoryOne, ADMIN, { name: "Categoria Ficticia Tres", confirmed: true }), idContext(LISTS[0], seed.categoryOne));
    expect(renameCategory.status).toBe(200);
    const renameMunicipality = await updateMunicipalityHandler(api.deps)(
      new Request(`http://localhost/api/v1/municipalities/${seed.municipalityOne}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: ADMIN })) }, body: JSON.stringify({ name: "Municipio Ficticio Renombrado", confirmed: true }) }),
      { params: Promise.resolve({ municipalityId: seed.municipalityOne }) },
    );
    expect(renameMunicipality.status).toBe(200);
    const json = await body(await api.listAs(VISITOR));
    expect(json.items[0]).toMatchObject({ id: created.id, category: { name: "Categoria Ficticia Tres" }, municipality: { name: "Municipio Ficticio Renombrado" } });
    expect((await owner.query("select * from app.listing_versions")).rows[0]).toEqual(versionBefore);
  });
});

describe("criterio 29: paginación, orden y parámetros", () => {
  beforeEach(async () => {
    for (const name of ["Atractivo Ficticio Uno", "Atractivo Ficticio Dos", "Atractivo Ficticio Tres"]) {
      expect((await api.createAs(ADMIN, attractionBody(seed, { name }))).status).toBe(201);
    }
  });

  it("orden por nombre normalizado y luego ID; pageSize=2 recorre sin repetidos ni faltantes", async () => {
    const first = await body(await api.listAs(VISITOR, "pageSize=2&page=1"));
    const second = await body(await api.listAs(VISITOR, "pageSize=2&page=2"));
    expect(first.items.map((i: any) => i.name)).toEqual(["Atractivo Ficticio Dos", "Atractivo Ficticio Tres"]);
    expect(second.items.map((i: any) => i.name)).toEqual(["Atractivo Ficticio Uno"]);
    expect([first.page, first.pageSize, first.total]).toEqual([1, 2, 3]);
    expect([second.page, second.pageSize, second.total]).toEqual([2, 2, 3]);
    expect(validateSchema("PublicListingSummaryPage", first)).toEqual([]);
  });

  it("sin parámetros usa page 1 y pageSize 20; una página más allá del final responde 200 vacía", async () => {
    const json = await body(await api.listAs(VISITOR));
    expect([json.page, json.pageSize, json.items.length]).toEqual([1, 20, 3]);
    const beyond = await api.listAs(VISITOR, "page=5");
    expect(beyond.status).toBe(200);
    expect((await body(beyond)).items).toEqual([]);
  });

  it("parámetros inválidos dan 422 con el field del parámetro y no cambian la base", async () => {
    for (const [query, field] of [["pageSize=51", "pageSize"], ["pageSize=0", "pageSize"], ["page=0", "page"], ["municipalityId=no-uuid", "municipalityId"], ["kind=otro", "kind"]]) {
      const before = await snapshotAll(owner);
      const res = await api.listAs(VISITOR, query);
      const json = await body(res);
      expect(res.status, query).toBe(422);
      expect(json.code).toBe("validation_failed");
      expect(json.errors).toContainEqual({ field, code: "invalid", message: "El valor indicado no es válido." });
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
  });
});
