import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { makeProvider } from "../factories/review";
import { createTestBot, providerMenu } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { A_NAMES, B_NAMES, B_REASON, foreignStrings, seedIsolation, type IsolationFixtures } from "../helpers/listing-isolation";
import { A6, P2P, seedWorld, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate } from "../helpers/telegram";

// F016, criterios 17 y 18: B12 y los callbacks `rev:` forjados no abren ni listan fichas de otro prestador.
const NEW_PROVIDER = 900013002;
let owner: Pool;
let world: World;
let fx: IsolationFixtures;
const t = createTestBot();
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const foreign = () => foreignStrings(fx);
const line = (name: string, status: keyof typeof es.myListings.statuses) => es.myListings.line(name, es.myListings.statuses[status]);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  t.clear();
  await resetDb(owner);
  world = await seedWorld(owner);
  fx = await seedIsolation(owner, { aAccountId: world.a6Account, bAccountId: world.p2pAccount, municipalityId: world.municipalityOne, categoryId: world.categoryOne });
});

describe("criterio 17: B12 de cada prestador lista solo lo suyo", () => {
  // Cada actualización pasa por claimUpdate: processed_updates es la única tabla que cambia y suma 1 fila.
  async function openMyListings(user: number): Promise<string[]> {
    t.clear();
    const before = await snapshotAll(owner);
    await press(user, "ml:l");
    const after = await snapshotAll(owner);
    expect(changedTables(before, after)).toEqual(["processed_updates"]);
    expect(changedTables(before, after).filter((table) => table !== "processed_updates")).toEqual([]);
    expect(after.processed_updates!.count - before.processed_updates!.count).toBe(1);
    return t.texts();
  }

  it("A ve sus 3 líneas, sin nada de B", async () => {
    const texts = await openMyListings(A6);
    expect(texts[0]).toBe(es.myListings.title);
    expect(texts.slice(1).sort()).toEqual([line(A_NAMES.borrador, "draft"), line(A_NAMES.pendiente, "pending"), line(A_NAMES.borrador2, "draft")].sort());
    for (const needle of foreign()) for (const text of texts) expect(text).not.toContain(needle);
  });

  it("B ve sus 5 líneas (con motivo y «sigue visible»), sin nada de A", async () => {
    const texts = await openMyListings(P2P);
    expect(texts[0]).toBe(es.myListings.title);
    expect(texts.slice(1).sort()).toEqual(
      [
        line(B_NAMES.borrador, "draft"),
        line(B_NAMES.pendiente, "pending"),
        line(B_NAMES.publicada, "published"),
        [line(B_NAMES.edicion, "draft"), es.myListings.stillVisible].join("\n"),
        [line(B_NAMES.rechazada, "rejected"), es.myListings.reason(B_REASON)].join("\n"),
      ].sort(),
    );
    for (const name of Object.values(A_NAMES)) for (const text of texts) expect(text).not.toContain(name);
  });

  it("un prestador nuevo sin negocios recibe es.myListings.empty aunque existan fichas de A y B", async () => {
    await makeProvider(owner, NEW_PROVIDER, "9000130020");
    expect(await openMyListings(NEW_PROVIDER)).toEqual([es.myListings.empty]);
  });
});

describe("criterio 18: callbacks forjados no abren fichas ajenas", () => {
  it("los 5 prefijos rev: sobre la versión de B-pendiente reciben es.admin.forbidden y ningún dato de B", async () => {
    const versionId = fx.b.pendiente.versionId;
    for (const prefix of ["rev:o:", "rev:a:", "rev:r:", "rev:ca:", "rev:cr:"]) {
      t.clear();
      const before = await snapshotAll(owner);
      await press(A6, `${prefix}${versionId}`);
      expect(t.texts(), prefix).toEqual([es.admin.forbidden]);
      expect(t.messages(), prefix).toHaveLength(1);
      for (const needle of foreign()) expect(t.texts()[0]).not.toContain(needle);
      expect(changedTables(before, await snapshotAll(owner)).filter((table) => table !== "processed_updates"), prefix).toEqual([]);
    }
  });

  it("ml:l:<id de ficha de B> no coincide con B12: A recibe el menú B02 de prestador sin líneas de es.myListings", async () => {
    await press(A6, `ml:l:${fx.b.borrador.listingId}`);
    expect(t.texts()).toEqual(providerMenu);
    for (const text of t.texts()) {
      expect(text).not.toContain(es.myListings.title);
      for (const needle of foreign()) expect(text).not.toContain(needle);
    }
  });
});
