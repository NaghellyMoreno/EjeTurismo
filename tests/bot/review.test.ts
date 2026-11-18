/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de la base sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount } from "../factories/accounts";
import { buttonsOf, createTestBot } from "../helpers/bot";
import { TEST_APP_BASE_URL, TEST_PRINCIPAL_ADMIN_ID } from "../helpers/config";
import { ownerPool, resetDb } from "../helpers/db";
import { seedListing } from "../helpers/listing-data";
import { A6, ADMIN, makeReviewListingApi, NAME_ONE, NAME_THREE, NAME_TWO, P2P, REASON, seedWorld, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F014, criterios 3, 4, 6, 9, 10 (bot), 15 (caso forjado), 23 y 24: B10, B12 y B20 en el bot.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const T0 = new Date("2026-11-18T15:00:00Z");
let clock = T0;
let owner: Pool;
let world: World;
const t = createTestBot({ now: () => clock });
const setup = makeReviewListingApi(t.db);
const ADMIN_TWO = 900007002;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const at = (seconds: number) => (clock = new Date(T0.getTime() + seconds * 1000));
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user }));
const flush = async () => {
  while (afterTasks.length > 0) await afterTasks.shift()!();
};
const lastKeyboard = () => {
  const markup = t.messages().at(-1)!.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};
const session = async () => (await rows("select data from app.bot_sessions"))[0]?.data as Record<string, any> | undefined;
const statusOf = async (versionId: string) => (await rows("select status from app.listing_versions where id = $1", [versionId]))[0].status as string;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  t.clear();
  clock = T0;
  await resetDb(owner);
  world = await seedWorld(owner);
  await createAccount(owner, ADMIN_TWO, "Administrador Ficticio Dos");
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [ADMIN_TWO]);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 24: botones de menú", () => {
  it("el administrador (común y principal) ve «Fichas por revisar» con rev:l y el prestador ve «Mis fichas» con ml:l", async () => {
    await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Principal Ficticio");
    for (const user of [ADMIN, TEST_PRINCIPAL_ADMIN_ID]) {
      t.clear();
      await say(user, "/start");
      expect(buttonsOf(t.messages()[0]!.payload)).toContain(es.menu.reviews);
      expect(lastKeyboard().find((b) => b.text === es.menu.reviews)?.callback_data).toBe("rev:l");
    }
    t.clear();
    await say(A6, "/start");
    expect(buttonsOf(t.messages()[0]!.payload)).toEqual([es.menu.myListings, es.selfRevoke.button]);
    for (const user of [900007012, 900007013, 900007014, 900007015, 900008002]) {
      t.clear();
      await say(user, "/start");
      for (const m of t.messages()) {
        for (const label of [es.menu.reviews, es.admin.pendingButton]) expect(buttonsOf(m.payload)).not.toContain(label);
      }
    }
  });
});

describe("criterio 3: lista de fichas por revisar (B10)", () => {
  it("el administrador recibe FP y FP2 con su botón, sin número de identidad", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    const fp2 = await setup.pending(world, NAME_TWO);
    await press(ADMIN, "rev:l");
    const text = t.texts().join("\n");
    expect(t.texts()[0]).toContain(es.review.listTitle);
    for (const name of [NAME_ONE, NAME_TWO]) expect(text).toContain(name);
    expect(text).toContain("Municipio Ficticio Uno");
    expect(text).toContain(es.review.kinds.establishment);
    const buttons = lastKeyboard();
    expect(buttons.map((b) => b.callback_data)).toEqual([`rev:o:${fp.versionId}`, `rev:o:${fp2.versionId}`]);
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
    expect(text).not.toContain("9000070310");
    expect(text).not.toContain(String(A6));
  });

  it("con 11 pendientes muestra 10 y review.morePending; sin pendientes responde review.empty", async () => {
    await press(ADMIN, "rev:l");
    expect(t.texts()).toEqual([es.review.empty]);
    for (let i = 1; i <= 11; i++) {
      await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: `Ficha Pendiente ${i}`, status: "pending" });
    }
    t.clear();
    await press(ADMIN, "rev:l");
    expect(lastKeyboard().length).toBe(0); // el último mensaje es morePending (sin teclado)
    expect(t.texts()[1]).toBe(es.review.morePending);
    const list = t.messages()[0]!.payload.reply_markup as { inline_keyboard: unknown[][] };
    expect(list.inline_keyboard.flat()).toHaveLength(10);
  });
});

describe("criterio 4: detalle B10", () => {
  it("muestra el contenido, la lista de cambios y los botones Aprobar y Rechazar", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:o:${fp.versionId}`);
    const text = t.texts()[0]!;
    for (const part of [NAME_ONE, "Municipio Ficticio Uno", "Categoria Ficticia Uno", "Descripción ficticia.", "Todos los días de 8:00 a 17:00", "contacto@ejemplo.invalid", "https://maps.app.goo.gl/AbCdEf123", es.review.firstReview]) {
      expect(text).toContain(part);
    }
    const fields = ["name", "municipality", "category", "establishmentType", "description", "schedule", "contact", "mapsUrl"] as const;
    expect(text).toContain(es.review.changed(fields.map((f) => es.review.fields[f]).join(", ")));
    expect(lastKeyboard().map((b) => [b.text, b.callback_data])).toEqual([[es.review.approve, `rev:a:${fp.versionId}`], [es.review.reject, `rev:r:${fp.versionId}`]]);
  });

  it("un callback con un versionId mal formado o forjado se ignora con review.notFound y no cambia la instantánea", async () => {
    await setup.pending(world, NAME_ONE);
    for (const data of ["rev:o:no-uuid", "rev:o:00000000-0000-4000-8000-000000000000", "rev:o:", "rev:zz:00000000-0000-4000-8000-000000000000"]) {
      t.clear();
      const before = await snapshotAll(owner);
      await press(ADMIN, data);
      expect(t.texts(), data).toEqual([es.review.notFound]);
      expect(changedTables(before, await snapshotAll(owner)), data).toEqual(["processed_updates"]);
    }
  });
});

describe("criterio 6: motivo del rechazo y vencimiento de la sesión", () => {
  it("pide el motivo; un texto vacío, solo espacios, un sticker o de más de 4096 caracteres da review.reasonInvalid y la conversación sigue", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:r:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.askReason]);
    expect(await session()).toMatchObject({ form: "listing_review", step: "reason", draft: { versionId: fp.versionId } });
    expect(Object.keys((await session())!.draft)).toEqual(["versionId"]);
    const before = await snapshotAll(owner);
    const sticker = textUpdate("x", { fromId: ADMIN }) as { message: Record<string, unknown> };
    delete sticker.message.text;
    sticker.message.sticker = { file_id: "f", file_unique_id: "u", type: "regular", width: 1, height: 1, is_animated: false, is_video: false };
    for (const input of ["", "   ", "a".repeat(4097), sticker]) {
      t.clear();
      await (typeof input === "string" ? say(ADMIN, input) : t.send(input));
      expect(t.texts()).toEqual([es.review.reasonInvalid]);
    }
    expect((await session())!.step).toBe("reason");
    expect(changedTables(before, await snapshotAll(owner))).toEqual(["processed_updates"]);
    expect(await statusOf(fp.versionId)).toBe("pending");
  });

  it("/cancelar y el botón Cancelar terminan la conversación con exactamente review.cancelled", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    for (const cancel of [() => say(ADMIN, "/cancelar"), () => press(ADMIN, `rev:x:${fp.versionId}`)]) {
      await press(ADMIN, `rev:r:${fp.versionId}`);
      t.clear();
      const before = await snapshotAll(owner);
      await cancel();
      expect(t.texts()).toEqual([es.review.cancelled]);
      expect(es.review.cancelled).toBe("Revisión cancelada. No se hizo ningún cambio.");
      expect(await session()).toEqual({});
      expect(changedTables(before, await snapshotAll(owner)).sort()).toEqual(["bot_sessions", "processed_updates"]);
      expect(await statusOf(fp.versionId)).toBe("pending");
    }
  });

  it("a 599 s un texto válido todavía se acepta; a 600 s un texto no ejecuta nada y responde review.sessionExpired", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:r:${fp.versionId}`);
    at(599);
    t.clear();
    await say(ADMIN, REASON);
    expect(t.texts()).toEqual([es.review.confirmReject(NAME_ONE, REASON)]);
    expect(await session()).toMatchObject({ step: "confirm_reject", draft: { versionId: fp.versionId, reason: REASON } });

    // Otro intento: el paso del motivo, esta vez vencido a 600 s exactos.
    clock = T0;
    await press(ADMIN, `rev:r:${fp.versionId}`);
    at(600);
    t.clear();
    const before = await snapshotAll(owner);
    await say(ADMIN, REASON);
    expect(t.texts()).toEqual([es.review.sessionExpired]);
    expect(await session()).toEqual({});
    expect(changedTables(before, await snapshotAll(owner)).sort()).toEqual(["bot_sessions", "processed_updates"]);
    expect(await statusOf(fp.versionId)).toBe("pending");
  });

  it("a 600 s después del último paso, «Sí, rechazar» no ejecuta nada y responde review.sessionExpired", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:r:${fp.versionId}`);
    await say(ADMIN, REASON);
    at(600);
    t.clear();
    const before = await snapshotAll(owner);
    await press(ADMIN, `rev:cr:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.sessionExpired]);
    expect(await session()).toEqual({});
    expect(changedTables(before, await snapshotAll(owner)).sort()).toEqual(["bot_sessions", "processed_updates"]);
    expect(await statusOf(fp.versionId)).toBe("pending");
    expect(afterTasks).toHaveLength(0);
  });
});

describe("criterio 9: rechazo de punta a punta", () => {
  it("Cancelar no cambia nada; «Sí, rechazar» rechaza, avisa al administrador y al prestador; repetir responde review.alreadyDecided", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:r:${fp.versionId}`);
    await say(ADMIN, REASON);
    expect(lastKeyboard().map((b) => [b.text, b.callback_data])).toEqual([[es.review.yesReject, `rev:cr:${fp.versionId}`], [es.review.cancel, `rev:x:${fp.versionId}`]]);
    t.clear();
    await press(ADMIN, `rev:x:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.cancelled]);
    expect(await statusOf(fp.versionId)).toBe("pending");
    expect(await rows("select * from app.notification_outbox")).toHaveLength(0);

    await press(ADMIN, `rev:r:${fp.versionId}`);
    await say(ADMIN, REASON);
    t.clear();
    await press(ADMIN, `rev:cr:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.rejected]);
    expect(await statusOf(fp.versionId)).toBe("rejected");
    expect((await rows("select rejection_reason, decided_by from app.listing_versions where id = $1", [fp.versionId]))[0].rejection_reason).toBe(REASON);
    await flush();
    const toProvider = t.messages().filter((m) => String(m.payload.chat_id) === String(A6));
    expect(toProvider.map((m) => m.payload.text)).toEqual([es.provider.listingRejected(NAME_ONE, REASON)]);
    expect((await rows("select status from app.notification_outbox"))[0].status).toBe("sent");

    t.clear();
    const before = await snapshotAll(owner);
    await press(ADMIN, `rev:cr:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.alreadyDecided]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual(["processed_updates"]);
  });
});

describe("criterio 23: aprobación de punta a punta", () => {
  it("Cancelar no cambia nada; «Sí, aprobar» publica, avisa al prestador y deja la auditoría", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:a:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.confirmApprove(NAME_ONE)]);
    expect(lastKeyboard().map((b) => b.text)).toEqual([es.review.yesApprove, es.review.cancel]);
    t.clear();
    await press(ADMIN, `rev:x:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.cancelled]);
    expect(await statusOf(fp.versionId)).toBe("pending");

    await press(ADMIN, `rev:a:${fp.versionId}`);
    t.clear();
    await press(ADMIN, `rev:ca:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.approved]);
    expect(await statusOf(fp.versionId)).toBe("published");
    expect(await rows("select action from app.audit_events where action = 'listing.approved'")).toHaveLength(1);
    expect(await rows("select template from app.notification_outbox")).toEqual([{ template: "listing_approved" }]);
    await flush();
    expect(t.messages().filter((m) => String(m.payload.chat_id) === String(A6)).map((m) => m.payload.text)).toEqual([es.provider.listingApproved(NAME_ONE)]);
    t.clear();
    await press(ADMIN, `rev:ca:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.alreadyDecided]);
  });

  it("un administrador distinto del que abrió la sesión no puede confirmar con una sesión ajena (la sesión es por cuenta)", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, `rev:a:${fp.versionId}`);
    t.clear();
    await press(ADMIN_TWO, `rev:ca:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.sessionExpired]);
    expect(await statusOf(fp.versionId)).toBe("pending");
    await press(ADMIN_TWO, `rev:r:${fp.versionId}`);
    await say(ADMIN, "Un mensaje del primer administrador");
    expect(await statusOf(fp.versionId)).toBe("pending");
  });

  it("la ficha de un prestador sin permiso no se puede aprobar (review.ownerRevoked) y la sesión se cierra", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'provider'", [A6]);
    await press(ADMIN, `rev:a:${fp.versionId}`);
    t.clear();
    await press(ADMIN, `rev:ca:${fp.versionId}`);
    expect(t.texts()).toEqual([es.review.ownerRevoked]);
    expect(await statusOf(fp.versionId)).toBe("pending");
    expect(await session()).toEqual({});
  });
});

describe("criterio 15: callbacks de revisión forjados por un prestador", () => {
  it("A6 pulsa rev:o, rev:a y rev:cr con el versionId de su propia ficha pendiente: es.admin.forbidden y nada cambia", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    for (const data of [`rev:o:${fp.versionId}`, `rev:a:${fp.versionId}`, `rev:cr:${fp.versionId}`]) {
      t.clear();
      const before = await snapshotAll(owner);
      await press(A6, data);
      expect(t.texts(), data).toEqual([es.admin.forbidden]);
      expect(changedTables(before, await snapshotAll(owner)), data).toEqual(["processed_updates"]);
    }
    expect(await statusOf(fp.versionId)).toBe("pending");
    expect(await rows("select * from app.notification_outbox")).toHaveLength(0);
    expect((await rows("select count(*)::int as n from app.listing_status_events where to_status in ('published', 'rejected')"))[0].n).toBe(0);
  });
});

describe("criterio 10 (bot): B12 mis fichas", () => {
  it("A6 recibe cada ficha con su estado, el motivo en la rechazada y un botón que abre la Mini App; P2p no ve las de A6", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await setup.pending(world, NAME_TWO);
    await setup.reject(ADMIN, fp.versionId, { confirmed: true, reason: REASON });
    await flush();
    t.clear();
    await press(A6, "ml:l");
    const texts = t.texts();
    expect(texts[0]).toBe(es.myListings.title);
    expect(texts).toContain(es.myListings.line(NAME_ONE, es.myListings.statuses.rejected) + "\n" + es.myListings.reason(REASON));
    expect(texts).toContain(es.myListings.line(NAME_TWO, es.myListings.statuses.pending));
    const web = t.messages()[0]!.payload.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] };
    expect(web.inline_keyboard.flat()).toEqual([{ text: es.myListings.open, web_app: { url: `${TEST_APP_BASE_URL}/fichas` } }]);

    // P2p con una ficha propia no ve la de A6.
    await setup.pending(world, NAME_THREE, P2P);
    t.clear();
    await press(P2P, "ml:l");
    const own = t.texts().join("\n");
    expect(own).toContain(NAME_THREE);
    expect(own).not.toContain(NAME_ONE);
    expect(own).not.toContain(REASON);
  });

  it("sin fichas responde myListings.empty; quien no es prestador recibe es.admin.forbidden", async () => {
    await press(P2P, "ml:l");
    expect(t.texts()).toEqual([es.myListings.empty]);
    t.clear();
    await press(ADMIN, "ml:l");
    expect(t.texts()).toEqual([es.admin.forbidden]);
    t.clear();
    await press(900007012, "ml:l");
    expect(t.texts()).toEqual([es.admin.forbidden]);
  });
});

describe("criterio 26 (bot): los mensajes no llevan datos personales", () => {
  it("ningún mensaje del recorrido lleva el número de identidad ni el ID de Telegram del prestador", async () => {
    const fp = await setup.pending(world, NAME_ONE);
    await press(ADMIN, "rev:l");
    await press(ADMIN, `rev:o:${fp.versionId}`);
    await press(ADMIN, `rev:r:${fp.versionId}`);
    await say(ADMIN, REASON);
    await press(ADMIN, `rev:cr:${fp.versionId}`);
    await flush();
    await press(A6, "ml:l");
    const everything = t.calls.map((c) => JSON.stringify(c.payload).replace(/"chat_id":"?\d+"?/g, "")).join("\n");
    for (const secret of ["9000070310", "900007031"]) expect(everything).not.toContain(secret);
  });
});
