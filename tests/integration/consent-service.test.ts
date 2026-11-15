import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { acceptPrivacyNotice, getCurrentPrivacyNotice, getMe } from "@/server/services";
import { appDb, counts, EMPTY_COUNTS, NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { ACCEPTING_USER, NEW_USER, OLD_VERSION_USER } from "../helpers/telegram";

let owner: Pool;
const db = appDb();
beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(() => resetDb(owner));
afterEach(async () => {
  await owner.query("drop trigger if exists fail_consent_insert on app.consent_events");
  await owner.query("drop function if exists app.fail_consent_insert()");
});

const actor = (id: number, displayName = "Persona Prueba Uno") => ({ telegramUserId: String(id), displayName });

describe("acceptPrivacyNotice (criterios 15, 16, 12)", () => {
  it("crea la cuenta y una sola prueba de aceptación, con fecha entre el instante anterior y el posterior", async () => {
    const before = new Date();
    await acceptPrivacyNotice(db, actor(ACCEPTING_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" });
    const after = new Date();

    const accounts = (await owner.query("select * from app.accounts")).rows;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      telegram_user_id: String(ACCEPTING_USER),
      telegram_display_name: "Persona Prueba Uno",
      consent_notice_version: NOTICE_VERSION,
      consent_channel: "bot",
    });
    expect(accounts[0].consent_accepted_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(accounts[0].consent_accepted_at.getTime()).toBeLessThanOrEqual(after.getTime() + 1);

    const events = (await owner.query("select * from app.consent_events")).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "accepted", channel: "bot", notice_version: NOTICE_VERSION });
    expect(events[0].occurred_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(events[0].occurred_at.getTime()).toBeLessThanOrEqual(after.getTime() + 1);
  });

  it("es idempotente: aceptar dos veces deja una cuenta y un evento y responde igual", async () => {
    const first = await acceptPrivacyNotice(db, actor(ACCEPTING_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" });
    const second = await acceptPrivacyNotice(db, actor(ACCEPTING_USER), { noticeVersion: NOTICE_VERSION, channel: "mini_app" });
    expect(second).toEqual(first);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1 });
    expect((await owner.query("select consent_channel from app.accounts")).rows[0].consent_channel).toBe("bot");
  });

  it("dos aceptaciones simultáneas tampoco duplican nada", async () => {
    await Promise.all([
      acceptPrivacyNotice(db, actor(ACCEPTING_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" }),
      acceptPrivacyNotice(db, actor(ACCEPTING_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" }),
    ]);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1 });
  });

  it("con una versión que no es la vigente responde 409 notice_version_outdated y no crea nada (criterio 13)", async () => {
    await expect(acceptPrivacyNotice(db, actor(NEW_USER), { noticeVersion: "2026-10-vX", channel: "bot" })).rejects.toMatchObject({
      status: 409,
      code: "notice_version_outdated",
    });
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });
});

describe("transacción única (criterio 17)", () => {
  it("si falla el insert de consent_events no queda fila en accounts ni en consent_events", async () => {
    // El fallo se inyecta con un disparador temporal creado por el rol propietario; el código de producción no cambia.
    await owner.query(`create function app.fail_consent_insert() returns trigger language plpgsql as $$ begin raise exception 'fallo inyectado'; end $$`);
    await owner.query("create trigger fail_consent_insert before insert on app.consent_events for each row execute function app.fail_consent_insert()");

    await expect(acceptPrivacyNotice(db, actor(NEW_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" })).rejects.toThrow(/fallo inyectado/);
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });
});

describe("getCurrentPrivacyNotice (criterio 6)", () => {
  it("devuelve el aviso vigente", async () => {
    const notice = await getCurrentPrivacyNotice(db);
    expect(notice.version).toBe(NOTICE_VERSION);
    expect(notice.publishedAt).toBeInstanceOf(Date);
  });
  it("lanza 404 not_found si no hay ninguna versión vigente", async () => {
    await owner.query("update app.privacy_notice_versions set is_current = false");
    await expect(getCurrentPrivacyNotice(db)).rejects.toBeInstanceOf(AppError);
    await expect(getCurrentPrivacyNotice(db)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("getMe (criterios 22, 23, 28a)", () => {
  it("sin cuenta: consent.required, nada aceptado, sin nombre ni roles, y no escribe nada", async () => {
    const me = await getMe(db, actor(NEW_USER));
    expect(me).toMatchObject({
      telegramUserId: String(NEW_USER),
      displayName: null,
      consent: { required: true, currentVersion: NOTICE_VERSION, acceptedVersion: null, acceptedAt: null },
      roles: [],
    });
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });

  it("con la versión vigente aceptada: required=false, versión, fecha ISO UTC y roles vacíos", async () => {
    await acceptPrivacyNotice(db, actor(ACCEPTING_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" });
    const me = await getMe(db, actor(ACCEPTING_USER));
    expect(me.consent).toMatchObject({ required: false, acceptedVersion: NOTICE_VERSION });
    expect(me.consent.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(me.roles).toEqual([]);
    expect(me.displayName).toBe("Persona Prueba Uno");
  });

  it("con una versión anterior aceptada: required=true y conserva acceptedVersion", async () => {
    await acceptPrivacyNotice(db, actor(OLD_VERSION_USER), { noticeVersion: NOTICE_VERSION, channel: "bot" });
    await owner.query("update app.privacy_notice_versions set is_current = false");
    await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-12-v1', 'b', 'd', true)");
    const me = await getMe(db, actor(OLD_VERSION_USER));
    expect(me.consent).toMatchObject({ required: true, currentVersion: "2026-12-v1", acceptedVersion: NOTICE_VERSION });
  });
});
