/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de la base sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { buttonsOf, createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { draftBody, SUBMIT_BODY } from "../helpers/listing-http";
import { A6, ADMIN, makeReviewListingApi, NAME_ONE, NAME_TWO, P2P, seedWorld, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F015, criterios 7 (B10), 9a (B12), 11 (bot), 13b y 18 (cancelar): la edición de una ficha publicada en el bot.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const OLD = "Lunes a viernes de 8:00 a 17:00";
const NEW = "Todos los días de 7:00 a 19:00";
const RENAMED = "Establecimiento Ficticio Uno Renovado";
const EDIT_REASON = "Falta el horario del domingo.";
let owner: Pool;
let world: World;
const t = createTestBot();
const setup = makeReviewListingApi(t.db);
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user }));
const flush = async () => {
  while (afterTasks.length > 0) await afterTasks.shift()!();
};
const keyboard = (message = t.messages().at(-1)!) => {
  const markup = message.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};

async function publish(name = NAME_ONE) {
  const p = await setup.pending(world, name, A6, { schedule: OLD });
  expect((await setup.approve(ADMIN, p.versionId)).status).toBe(200);
  await flush();
  return p.listingId;
}
async function pendingEdit(listingId: string, content: Record<string, unknown> = {}) {
  expect((await setup.save(A6, listingId, draftBody(world, { schedule: NEW, ...content }))).status).toBe(200);
  const res = await setup.submit(A6, listingId, SUBMIT_BODY);
  expect(res.status).toBe(200);
  return ((await res.json()) as any).working.id as string;
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  t.clear();
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 7: B10 distingue lo que cambió en una edición", () => {
  it("muestra review.changed con los campos cambiados, sin review.firstReview, con Aprobar y Rechazar", async () => {
    const fp = await publish();
    const v2 = await pendingEdit(fp);
    await press(ADMIN, `rev:o:${v2}`);
    const text = t.texts()[0]!;
    expect(text).toContain(es.review.changed("Horarios"));
    expect(text).toContain(NEW);
    expect(text).not.toContain(es.review.firstReview);
    expect(keyboard().map((b) => b.callback_data)).toEqual([`rev:a:${v2}`, `rev:r:${v2}`]);

    const other = await publish(NAME_TWO);
    const v3 = await pendingEdit(other, { name: `${NAME_TWO} Renovado` });
    t.clear();
    await press(ADMIN, `rev:o:${v3}`);
    expect(t.texts()[0]).toContain(es.review.changed("Nombre, Horarios"));
  });
});

describe("criterios 9a y 11: avisos y B12 de una edición", () => {
  it("el rechazo por el bot avisa con editRejected y B12 muestra el motivo y que la publicada sigue visible", async () => {
    const fp = await publish();
    const v2 = await pendingEdit(fp, { name: RENAMED });
    t.clear();
    await press(ADMIN, `rev:r:${v2}`);
    await say(ADMIN, EDIT_REASON);
    await press(ADMIN, `rev:cr:${v2}`);
    await flush();
    expect(t.messages().filter((m) => String(m.payload.chat_id) === String(A6)).map((m) => m.payload.text)).toEqual([es.provider.editRejected(RENAMED, EDIT_REASON)]);

    t.clear();
    await press(A6, "ml:l");
    expect(t.texts()).toContain([es.myListings.line(RENAMED, es.myListings.statuses.published), es.myListings.reason(EDIT_REASON), es.myListings.stillVisible].join("\n"));

    await press(P2P, "ml:l");
    expect(t.texts().slice(-1)[0]).toBe(es.myListings.empty);
    expect(t.texts().slice(-1)[0]).not.toContain(EDIT_REASON);
  });

  it("B12 con borrador y con pendiente agrega la línea de que la publicada sigue visible; sin edición no", async () => {
    const a = await publish();
    const b = await publish(NAME_TWO);
    await publish("Establecimiento Ficticio Tres");
    expect((await setup.save(A6, a, draftBody(world, { schedule: NEW }))).status).toBe(200);
    await pendingEdit(b, { name: NAME_TWO });
    t.clear();
    await press(A6, "ml:l");
    const texts = t.texts();
    expect(texts).toContain([es.myListings.line(NAME_ONE, es.myListings.statuses.draft), es.myListings.stillVisible].join("\n"));
    expect(texts).toContain([es.myListings.line(NAME_TWO, es.myListings.statuses.pending), es.myListings.stillVisible].join("\n"));
    expect(texts).toContain(es.myListings.line("Establecimiento Ficticio Tres", es.myListings.statuses.published));
  });

  it("la aprobación de punta a punta: Cancelar no cambia nada y «Sí, aprobar» publica y avisa con editApproved", async () => {
    const fp = await publish();
    const v2 = await pendingEdit(fp, { name: RENAMED });
    const before = await snapshotAll(owner);
    await press(ADMIN, `rev:a:${v2}`);
    expect(t.texts().at(-1)).toBe(es.review.confirmApprove(RENAMED));
    t.clear();
    await press(ADMIN, `rev:x:${v2}`);
    expect(t.texts()).toEqual([es.review.cancelled]);
    expect(changedTables(before, await snapshotAll(owner)).filter((table) => !["bot_sessions", "processed_updates"].includes(table))).toEqual([]);
    expect((await rows("select status from app.listing_versions where id = $1", [v2]))[0].status).toBe("pending");

    await press(ADMIN, `rev:a:${v2}`);
    t.clear();
    await press(ADMIN, `rev:ca:${v2}`);
    expect(t.texts()).toEqual([es.review.approved]);
    await flush();
    expect(t.messages().filter((m) => String(m.payload.chat_id) === String(A6)).map((m) => m.payload.text)).toEqual([es.provider.editApproved(RENAMED)]);
    expect((await rows("select status from app.listing_versions where listing_id = $1 order by version_number", [fp])).map((r) => r.status)).toEqual(["superseded", "published"]);
  });
});

describe("criterio 13b: ningún botón del bot despublica, elimina ni retira", () => {
  it("B12 y B06 con A6 en cada estado de la ficha", async () => {
    const forbidden = /unpublish|delete|withdraw|remove|archive|despublicar|eliminar|retirar|borrar ficha/i;
    const fp = await publish();
    const checkAll = async (label: string) => {
      t.clear();
      await press(A6, "ml:l");
      await say(A6, "/start");
      for (const m of t.messages()) {
        expect(String(m.payload.text), label).not.toMatch(forbidden);
        for (const b of keyboard(m)) expect(`${b.text} ${b.callback_data ?? ""}`, label).not.toMatch(forbidden);
        expect(buttonsOf(m.payload).join(" "), label).not.toMatch(forbidden);
      }
    };
    await checkAll("publicada");
    await setup.save(A6, fp, draftBody(world, { schedule: NEW }));
    await checkAll("borrador");
    const v2 = ((await (await setup.submit(A6, fp, SUBMIT_BODY)).json()) as any).working.id as string;
    await checkAll("pendiente");
    await setup.reject(ADMIN, v2, { confirmed: true, reason: EDIT_REASON });
    await flush();
    await checkAll("edición rechazada");
  });
});
