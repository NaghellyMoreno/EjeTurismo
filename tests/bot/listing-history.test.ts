import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_PAGE_SIZE } from "@/bot/history";
import { es } from "@/bot/texts/es";
import { revokeRoleHandler } from "@/server/http/handlers";
import { revokedAdmin } from "../factories/revocation";
import { buttonsOf, createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { A6_NAME, AD2, AD2_NAME, ADMIN_NAME, FIXED_BOGOTA, recorrerFh, seedAd2, seedEvents, type FhIds } from "../helpers/history";
import { seedListing } from "../helpers/listing-data";
import { A6, ADMIN, makeReviewListingApi, NAME_ONE, NAME_TWO, P2P, REASON, seedWorld, UNKNOWN_ID, VISITOR, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { makeSelfRevokeApi } from "../helpers/self-revoke-http";
import { callbackUpdate, signInitData, textUpdate, tma } from "../helpers/telegram";

// F029, criterios 2, 3, 6, 10, 11 (bot), 13, 14, 15 y 19: B11, historial de fichas en el bot (administrador).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user }));
const keyboard = (index = -1) => {
  const markup = t.messages().at(index)!.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};
// Líneas de cambio del mensaje B11 (sin el título), unidas de todos los mensajes.
const changeLines = () => t.texts().flatMap((text) => text.split("\n")).slice(1);

async function fh(name = NAME_ONE): Promise<FhIds> {
  return recorrerFh(api, owner, world, afterTasks, name);
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
  await seedAd2(owner);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 2: lista de fichas (B11)", () => {
  it("el menú de administrador trae «Historial de fichas» con his:l y el del prestador y el visitante no", async () => {
    await say(ADMIN, "/start");
    expect(buttonsOf(t.messages()[0]!.payload)).toContain(es.menu.history);
    expect(keyboard(0).find((b) => b.text === es.menu.history)?.callback_data).toBe("his:l");
    for (const user of [A6, VISITOR]) {
      t.clear();
      await say(user, "/start");
      for (const m of t.messages()) expect(buttonsOf(m.payload)).not.toContain(es.menu.history);
    }
  });

  it("muestra FH con su botón (nombre y municipio), callback_data de a lo más 64 bytes, sin identidad ni ID de Telegram", async () => {
    const f = await fh();
    await press(ADMIN, "his:l");
    const text = t.texts().join("\n");
    expect(text).toContain(es.history.listTitle);
    expect(text).toContain(NAME_ONE);
    expect(text).toContain("Municipio Ficticio Uno");
    expect(keyboard().map((b) => b.callback_data)).toEqual([`his:o:${f.listingId}`]);
    for (const b of keyboard()) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
    for (const secret of ["9000070310", String(A6), String(ADMIN), String(AD2)]) expect(text).not.toContain(secret);
  });

  it("sin fichas responde history.empty", async () => {
    await press(ADMIN, "his:l");
    expect(t.texts()).toEqual([es.history.empty]);
  });

  it("con 11 fichas de actividad distinta muestra 10 y history.moreListings; queda fuera la más antigua", async () => {
    for (let i = 1; i <= 11; i++) {
      const seeded = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: `Ficha Historial ${String(i).padStart(2, "0")}` });
      await owner.query("update app.listing_status_events set occurred_at = $1 where listing_id = $2", [new Date(Date.UTC(2026, 10, i)).toISOString(), seeded.listingId]);
    }
    await press(ADMIN, "his:l");
    expect(keyboard(0)).toHaveLength(HISTORY_PAGE_SIZE);
    expect(t.texts()[1]).toBe(es.history.moreListings);
    const text = t.texts()[0]!;
    expect(text).not.toContain("Ficha Historial 01");
    for (let i = 2; i <= 11; i++) expect(text).toContain(`Ficha Historial ${String(i).padStart(2, "0")}`);
    // La de actividad más reciente va primero.
    expect(keyboard(0)[0]!.text).toContain("Ficha Historial 11");
  });

  it("un empate de max(occurred_at) se ordena por listingId ascendente", async () => {
    const a = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Empate A" });
    const b = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Empate B" });
    await owner.query("update app.listing_status_events set occurred_at = '2026-11-22T10:00:00Z' where listing_id in ($1, $2)", [a.listingId, b.listingId]);
    await press(ADMIN, "his:l");
    expect(keyboard(0).map((x) => x.callback_data)).toEqual([a.listingId, b.listingId].sort().map((id) => `his:o:${id}`));
  });
});

describe("criterio 3: abrir el historial de una ficha", () => {
  it("al elegir FH llega el título con el nombre y exactamente 6 líneas de cambio", async () => {
    const f = await fh();
    await press(ADMIN, `his:o:${f.listingId}`);
    expect(t.texts()).toHaveLength(1);
    expect(t.texts()[0]!.split("\n")[0]).toBe(es.history.title(NAME_ONE));
    expect(changeLines()).toHaveLength(6);
  });

  it.each([
    ["no es UUID", () => "his:o:no-es-un-uuid"],
    ["UUID válido inexistente", () => `his:o:${UNKNOWN_ID}`],
    ["listingId truncado", () => `his:o:${UNKNOWN_ID.slice(0, 20)}`],
  ])("%s responde history.notFound y no cambia la instantánea", async (_name, data) => {
    await fh();
    t.clear();
    const before = await snapshotAll(owner);
    await press(ADMIN, data());
    expect(t.texts()).toEqual([es.history.notFound]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual(["processed_updates"]);
  });
});

describe("criterios 6 y 10: orden, etiquetas, fecha en Bogotá, responsable y motivo", () => {
  it("las 6 líneas van en el orden del historial, con las etiquetas de estado y sin UTC", async () => {
    const f = await fh();
    await press(ADMIN, `his:o:${f.listingId}`);
    const lines = changeLines();
    const s = es.history.statuses;
    expect(lines[0]).toContain(es.history.created);
    expect(lines[1]).toContain(`${s.draft} → ${s.pending}`);
    expect(lines[2]).toContain(`${s.pending} → ${s.rejected}`);
    expect(lines[3]).toContain(es.history.created);
    expect(lines[4]).toContain(`${s.draft} → ${s.pending}`);
    expect(lines[5]).toContain(`${s.pending} → ${s.published}`);
    // criterio 10
    expect(lines[2]).toContain(FIXED_BOGOTA);
    expect(lines[2]).toContain(ADMIN_NAME);
    expect(lines[2]).toContain(`${es.history.reasonLabel}: ${REASON}`);
    expect(lines[5]).toContain(AD2_NAME);
    expect(lines[5]).not.toContain(es.history.reasonLabel);
    for (const i of [0, 1, 3, 4]) expect(lines[i]).toContain(A6_NAME);
    for (const line of lines) {
      expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(line).not.toContain("03:30");
    }
    for (const name of [A6_NAME, ADMIN_NAME, AD2_NAME]) expect(name).not.toContain("Z");
  });

  it("6: 60 eventos de una sola ficha se dividen en mensajes de a lo más 4096 caracteres, sin perder ni repetir líneas", async () => {
    const seeded = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Sesenta Eventos" });
    const reason = "Motivo largo ".repeat(8).trim();
    await seedEvents(
      owner,
      seeded.listingId,
      seeded.versionId,
      Array.from({ length: 60 }, (_, i) => ({
        from: "draft",
        to: "rejected",
        role: "admin" as const,
        reason: `${reason} ${String(i).padStart(2, "0")}`,
        at: new Date(Date.UTC(2026, 10, 25, 12, i)).toISOString(),
      })),
    );
    // Los 60 eventos sembrados más el de creación de `seedListing`; las 60 líneas con el motivo son las sembradas.
    await press(ADMIN, `his:o:${seeded.listingId}`);
    for (const text of t.texts()) expect(text.length).toBeLessThanOrEqual(4096);
    const lines = changeLines();
    const mine = lines.filter((line) => line.includes(reason));
    expect(mine).toHaveLength(60);
    expect(new Set(lines).size).toBe(lines.length);
    expect(mine.map((line) => line.slice(-2))).toEqual(Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")));
    expect(t.texts().length).toBeGreaterThan(1);
  });
});

describe("criterio 11 (bot): responsable ausente", () => {
  it("a, b y c: el nombre ausente se muestra como history.actorRemoved", async () => {
    const seeded = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Ausentes" });
    await owner.query("update app.accounts set telegram_display_name = null where id = $1", [world.p2pAccount]);
    await seedEvents(owner, seeded.listingId, seeded.versionId, [
      { from: "draft", to: "pending", role: "admin", accountId: null, at: "2099-01-01T01:00:00Z" },
      { from: "pending", to: "rejected", role: "provider", accountId: world.p2pAccount, at: "2099-01-01T02:00:00Z" },
      { from: "rejected", to: "draft", role: "system", accountId: null, at: "2099-01-01T03:00:00Z" },
    ]);
    await press(ADMIN, `his:o:${seeded.listingId}`);
    const lines = changeLines().slice(-3);
    for (const line of lines) expect(line).toContain(es.history.actorRemoved);
  });

  it("d: tras la autorrevocación de A6 sus 4 líneas dicen history.actorRemoved y las del administrador conservan el nombre", async () => {
    const f = await fh();
    expect((await makeSelfRevokeApi(t.db).revoke(A6)).status).toBe(200);
    t.clear();
    await press(ADMIN, `his:o:${f.listingId}`);
    const lines = changeLines();
    expect(lines).toHaveLength(6);
    for (const i of [0, 1, 3, 4]) expect(lines[i]).toContain(es.history.actorRemoved);
    expect(lines[2]).toContain(ADMIN_NAME);
    expect(lines[5]).toContain(AD2_NAME);
  });

  it("e: el rol revocado por el administrador conserva el nombre", async () => {
    const f = await fh();
    const grant = (await rows("select id from app.role_grants where telegram_user_id = $1 and role = 'admin'", [ADMIN]))[0].id as string;
    const res = await revokeRoleHandler(api.deps)(
      new Request(`http://localhost/api/v1/role-grants/${grant}/revocation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: AD2 })) },
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: Promise.resolve({ grantId: grant }) },
    );
    expect(res.status).toBe(200);
    t.clear();
    await press(AD2, `his:o:${f.listingId}`);
    expect(changeLines()[2]).toContain(ADMIN_NAME);
  });
});

describe("criterio 13: acceso en el bot", () => {
  const secrets = (f: FhIds) => [NAME_ONE, f.listingId, f.v1, f.v2, REASON, A6_NAME, ADMIN_NAME];

  it("A6, un visitante y un administrador con el rol revocado reciben es.admin.forbidden y ningún dato", async () => {
    const f = await fh();
    await revokedAdmin(owner, 900007112);
    for (const user of [A6, VISITOR, 900007112]) {
      for (const data of ["his:l", `his:o:${f.listingId}`]) {
        t.clear();
        const before = await snapshotAll(owner);
        await press(user, data);
        expect(t.texts()).toEqual([es.admin.forbidden]);
        expect(changedTables(before, await snapshotAll(owner)), `${user} ${data}`).toEqual(["processed_updates"]);
      }
      // El texto «Historial de fichas» (no es un botón válido para quien no es administrador) tampoco muestra datos.
      t.clear();
      await say(user, es.menu.history);
      for (const text of t.texts()) for (const secret of secrets(f)) expect(text).not.toContain(secret);
    }
  });

  it("un administrador autorrevocado (cuenta borrada) no recibe ningún dato de la ficha: recibe el aviso de privacidad (D-039)", async () => {
    const f = await fh();
    expect((await makeSelfRevokeApi(t.db).revoke(ADMIN)).status).toBe(200);
    for (const data of ["his:l", `his:o:${f.listingId}`]) {
      t.clear();
      const before = await snapshotAll(owner);
      await press(ADMIN, data);
      for (const text of t.texts()) for (const secret of secrets(f)) expect(text).not.toContain(secret);
      expect(t.texts()[0]).toMatch(/^<b>Eje Turismo\. Aviso de privacidad/);
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
  });
});

describe("criterio 14: fichas sin eventos posteriores (bot)", () => {
  it("un borrador recién creado muestra 1 línea", async () => {
    const seeded = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Solo Borrador" });
    await press(ADMIN, `his:o:${seeded.listingId}`);
    expect(changeLines()).toHaveLength(1);
    expect(changeLines()[0]).toContain(es.history.created);
  });
});

describe("criterio 15: separación entre fichas (bot)", () => {
  it("el mensaje de FH no trae nombres ni motivos de FP2 ni FP3", async () => {
    const f = await fh();
    await api.pending(world, NAME_TWO, A6);
    await api.pending(world, "Establecimiento Ficticio Tres", P2P);
    t.clear();
    await press(ADMIN, `his:o:${f.listingId}`);
    expect(changeLines()).toHaveLength(6);
    const text = t.texts().join("\n");
    expect(text).not.toContain(NAME_TWO);
    expect(text).not.toContain("Establecimiento Ficticio Tres");
  });
});

describe("criterio 19: sin datos personales en el flujo del bot", () => {
  it("ni mensajes ni registros traen número de identidad ni ID de Telegram", async () => {
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    const f = await fh();
    t.clear();
    await press(ADMIN, "his:l");
    await press(ADMIN, `his:o:${f.listingId}`);
    const all = `${t.texts().join("\n")}\n${JSON.stringify(t.messages().map((m) => m.payload.reply_markup ?? null))}\n${logs.join("\n")}`;
    for (const secret of ["9000070310", String(A6), String(ADMIN), String(AD2)]) expect(all, secret).not.toContain(secret);
  });
});
