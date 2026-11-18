/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount } from "../factories/accounts";
import { ownerPool, resetDb } from "../helpers/db";
import { TEST_PRINCIPAL_ADMIN_ID } from "../helpers/config";
import { draftBody, SUBMIT_BODY } from "../helpers/listing-http";
import { seedListing } from "../helpers/listing-data";
import { validateSchema } from "../helpers/openapi";
import { A6, ADMIN, flush, makeReviewListingApi, NAME_ONE, NAME_THREE, NAME_TWO, P2P, REASON, seedWorld, VISITOR, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F014, criterios 10 (HTTP), 11, 12, 13, 16, 19 y 26: recorrido completo rechazar, corregir, reenviar y aprobar.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const status = async (versionId: string) => (await rows("select status from app.listing_versions where id = $1", [versionId]))[0].status as string;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  api.sent.length = 0;
  api.state.mode = "ok";
  api.state.now = () => new Date();
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

describe("criterios 10, 11, 12, 13, 16 y 26: recorrido completo", () => {
  it("rechazar, ver estado y motivo, corregir, reenviar, aprobar y ver la ficha como visitante", async () => {
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const fp = await api.pending(world, NAME_ONE);
    const fp2 = await api.pending(world, NAME_TWO);
    const fp3 = await api.pending(world, NAME_THREE, P2P);
    const bodies: string[] = [];
    const record = async (res: Response) => {
      const text = await res.clone().text();
      bodies.push(text);
      return res;
    };

    // Antes de aprobar el visitante no la ve.
    expect(JSON.stringify(await body(await api.published(VISITOR)))).not.toContain(NAME_ONE);

    // Rechazo (criterio 7) y lo que ven prestador, otro prestador y visitante (criterio 10).
    const rejection = await record(await api.reject(ADMIN, fp.versionId, { confirmed: true, reason: REASON }));
    expect(rejection.status).toBe(200);
    const mine = await body(await record(await api.get(A6, fp.listingId)));
    expect(mine.displayStatus).toBe("rejected");
    expect(mine.lastRejection.reason).toBe(REASON);
    const list = await body(await record(await api.list(A6)));
    expect(list.items.find((i: any) => i.id === fp.listingId).displayStatus).toBe("rejected");
    expect((await body(await api.list(A6, "displayStatus=rejected"))).items.map((i: any) => i.id)).toEqual([fp.listingId]);
    expect((await body(await api.list(A6, "displayStatus=pending"))).items.map((i: any) => i.id)).toEqual([fp2.listingId]);
    const other = await api.get(P2P, fp.listingId);
    expect(other.status).toBe(403);
    expect(await other.text()).not.toContain(REASON);
    expect(JSON.stringify(await body(await api.list(P2P)))).not.toContain(NAME_ONE);
    expect(JSON.stringify(await body(await api.published(VISITOR)))).not.toContain(NAME_ONE);

    // Criterio 12: otro prestador y el administrador no pueden reabrir ni reenviar.
    for (const [user, label] of [[P2P, "P2p"], [ADMIN, "administrador"]] as const) {
      const before = await snapshotAll(owner);
      const save = await api.save(user, fp.listingId, draftBody(world, { name: NAME_ONE }));
      const submit = await api.submit(user, fp.listingId, SUBMIT_BODY);
      expect([save.status, submit.status], label).toEqual([403, 403]);
      expect((await body(save)).code).toBe("forbidden");
      expect(changedTables(before, await snapshotAll(owner)), label).toEqual([]);
    }
    // Una ficha pendiente sigue sin editarse (F013).
    const locked = await api.save(A6, fp2.listingId, draftBody(world, { name: NAME_TWO }));
    expect(locked.status).toBe(409);
    expect((await body(locked)).code).toBe("invalid_state_transition");

    // Corregir (criterio 11): versión 2 en borrador y el motivo se conserva mientras corrige (P6).
    const corrected = await body(await record(await api.save(A6, fp.listingId, draftBody(world, { name: NAME_ONE, schedule: "Lunes a sábado de 9:00 a 18:00" }))));
    expect(corrected).toMatchObject({ displayStatus: "draft", lastRejection: { reason: REASON } });
    expect(corrected.working).toMatchObject({ status: "draft", versionNumber: 2 });
    expect(corrected.working.content.schedule).toBe("Lunes a sábado de 9:00 a 18:00");
    const versions = await rows("select version_number, status, rejection_reason, decided_by from app.listing_versions where listing_id = $1 order by version_number", [fp.listingId]);
    expect(versions.map((v) => [v.version_number, v.status])).toEqual([[1, "rejected"], [2, "draft"]]);
    expect(versions[0]).toMatchObject({ rejection_reason: REASON });
    expect(versions[0].decided_by).not.toBeNull();
    expect(await rows("select count(*)::int as n from app.listing_versions where listing_id = $1 and status in ('draft', 'pending')", [fp.listingId])).toEqual([{ n: 1 }]);
    // Guardar otra vez edita el mismo borrador (no crea una tercera versión).
    expect((await api.save(A6, fp.listingId, draftBody(world, { name: NAME_ONE, schedule: "Lunes a sábado de 9:00 a 18:00" }))).status).toBe(200);
    expect(await rows("select count(*)::int as n from app.listing_versions where listing_id = $1", [fp.listingId])).toEqual([{ n: 2 }]);

    const resubmitted = await record(await api.submit(A6, fp.listingId, SUBMIT_BODY));
    const sent = await body(resubmitted);
    expect(resubmitted.status).toBe(200);
    expect(sent).toMatchObject({ displayStatus: "pending", working: { status: "pending", versionNumber: 2 } });
    expect(sent.lastRejection).toBeUndefined();
    const review = (await body(await api.reviews(ADMIN))).items.find((i: any) => i.listingId === fp.listingId);
    expect(review).toMatchObject({ versionId: sent.working.id, isEditOfPublished: false });
    expect(await rows("select from_status, to_status from app.listing_status_events where version_id = $1 order by id", [sent.working.id])).toEqual([
      { from_status: null, to_status: "draft" },
      { from_status: "draft", to_status: "pending" },
    ]);

    // Criterio 13: aprobar sin confirmar da 422; con confirmación publica.
    for (const payload of [{}, { confirmed: false }]) {
      const before = await snapshotAll(owner);
      const res = await api.approve(ADMIN, sent.working.id, payload);
      expect(res.status).toBe(422);
      expect((await body(res)).errors).toEqual([expect.objectContaining({ field: "confirmed", code: "confirmation_required" })]);
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
    const approval = await record(await api.approve(ADMIN, sent.working.id));
    const approved = await body(approval);
    expect(approval.status).toBe(200);
    expect(validateSchema("ManagedListing", approved)).toEqual([]);
    expect(approved).toMatchObject({ displayStatus: "published", hasPublishedVersion: true, acceptsRequests: false, published: { versionNumber: 2 } });
    expect(approved.published.content.name).toBe(NAME_ONE);
    const admin = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN]))[0].id;
    const [v2] = await rows("select status, decided_by, decided_at, rejection_reason from app.listing_versions where id = $1", [sent.working.id]);
    expect(v2).toMatchObject({ status: "published", decided_by: admin, rejection_reason: null });
    expect(v2.decided_at).not.toBeNull();
    expect(await status(fp.versionId)).toBe("rejected");
    const events = await rows("select from_status, to_status, actor_role, reason from app.listing_status_events where version_id = $1 order by id", [sent.working.id]);
    expect(events.at(-1)).toEqual({ from_status: "pending", to_status: "published", actor_role: "admin", reason: null });
    expect(await rows("select details from app.audit_events where action = 'listing.approved'")).toHaveLength(1);
    const outbox = await rows("select template, recipient_telegram_user_id, payload from app.notification_outbox where template = 'listing_approved'");
    expect(outbox).toEqual([{ template: "listing_approved", recipient_telegram_user_id: String(A6), payload: { listingName: NAME_ONE } }]);
    await flush(afterTasks);
    expect(api.sent.map((m) => m.text)).toEqual([es.provider.listingRejected(NAME_ONE, REASON), es.provider.listingApproved(NAME_ONE)]);

    // El visitante la ve ahora, con filtros y sin datos personales del prestador.
    for (const query of ["", `municipalityId=${world.municipalityOne}`, `categoryId=${world.categoryOne}`, `municipalityId=${world.municipalityOne}&categoryId=${world.categoryOne}`]) {
      const visible = await api.published(VISITOR, query);
      const text = await visible.text();
      expect(text, query).toContain(NAME_ONE);
      expect(text, query).not.toContain("900007031");
      expect(text, query).not.toContain("9000070310");
    }

    // Criterio 16: el motivo no aparece en auditoría ni en registros técnicos; eje_app no actualiza ni borra eventos.
    expect(JSON.stringify(await rows("select details from app.audit_events"))).not.toContain(REASON);
    expect(logs.join("\n")).not.toContain(REASON);
    const app = new Pool({ connectionString: process.env.TEST_APP_URL });
    try {
      for (const statement of ["update app.listing_status_events set reason = 'x'", "delete from app.listing_status_events"]) {
        await expect(app.query(statement), statement).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await app.end();
    }

    // Criterio 26: ni los cuerpos de respuesta, ni los mensajes, ni el payload, ni la auditoría traen datos personales.
    const everything = [...bodies, ...api.sent.map((m) => m.text), JSON.stringify(await rows("select payload from app.notification_outbox")), JSON.stringify(await rows("select details from app.audit_events"))].join("\n");
    for (const secret of ["9000070310", "900007031", "CC"]) expect(everything.replace(/Categoria/g, ""), secret).not.toContain(secret);
    expect(JSON.stringify(await body(await api.published(VISITOR)))).not.toContain(REASON);

    // FP2 y FP3 siguen pendientes y A6 no puede decidirlas (criterio 22 se prueba en review-access).
    expect(await status(fp2.versionId)).toBe("pending");
    expect(await status(fp3.versionId)).toBe("pending");
  });

  it("criterio 16: el administrador principal también decide y queda como responsable", async () => {
    await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Principal Ficticio");
    const fp = await api.pending(world);
    const res = await api.approve(TEST_PRINCIPAL_ADMIN_ID, fp.versionId);
    expect(res.status).toBe(200);
    const principal = (await rows("select id from app.accounts where telegram_user_id = $1", [TEST_PRINCIPAL_ADMIN_ID]))[0].id;
    expect((await rows("select decided_by from app.listing_versions where id = $1", [fp.versionId]))[0].decided_by).toBe(principal);
    expect((await rows("select actor_account_id, actor_role from app.listing_status_events where version_id = $1 order by id desc limit 1", [fp.versionId]))[0]).toEqual({ actor_account_id: principal, actor_role: "admin" });
  });
});

describe("criterio 19: aprobar o rechazar una edición de una ficha ya publicada", () => {
  async function seedEdit() {
    const published = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: NAME_ONE, status: "published" });
    await owner.query(
      `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url, submitted_at)
       select listing_id, 2, 'pending', 'Nombre Nuevo Ficticio', 'nombre nuevo ficticio', municipality_id, category_id, 'Descripción nueva.', schedule, contact, maps_url, now() from app.listing_versions where id = $1`,
      [published.versionId],
    );
    const pendingId = (await rows("select id from app.listing_versions where listing_id = $1 and version_number = 2", [published.listingId]))[0].id as string;
    return { ...published, pendingId };
  }
  const visible = async () => JSON.stringify(await (await api.published(VISITOR)).json());

  it("aprobar deja una sola publicada, la anterior en superseded, y el visitante ve solo el contenido nuevo tras aprobar", async () => {
    const edit = await seedEdit();
    expect(await status(edit.versionId)).toBe("published");
    expect(await visible()).toContain(NAME_ONE);
    expect(await visible()).not.toContain("Nombre Nuevo Ficticio");
    const list = await body(await api.reviews(ADMIN));
    expect(list.items).toEqual([expect.objectContaining({ versionId: edit.pendingId, isEditOfPublished: true })]);
    expect((await api.approve(ADMIN, edit.pendingId)).status).toBe(200);
    expect(await rows("select version_number, status from app.listing_versions where listing_id = $1 order by version_number", [edit.listingId])).toEqual([
      { version_number: 1, status: "superseded" },
      { version_number: 2, status: "published" },
    ]);
    expect((await rows("select count(*)::int as n from app.listing_versions where listing_id = $1 and status = 'published'", [edit.listingId]))[0].n).toBe(1);
    expect(await visible()).toContain("Nombre Nuevo Ficticio");
    expect(await visible()).not.toContain(NAME_ONE);
  });

  it("rechazar deja la publicada anterior visible, con displayStatus published y lastRejection con el motivo", async () => {
    const edit = await seedEdit();
    const before = await (await api.published(VISITOR)).json();
    const res = await api.reject(ADMIN, edit.pendingId, { confirmed: true, reason: REASON });
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ displayStatus: "published", hasPublishedVersion: true, lastRejection: { reason: REASON }, published: { id: edit.versionId } });
    expect(await status(edit.versionId)).toBe("published");
    expect(await (await api.published(VISITOR)).json()).toEqual(before);
    expect(JSON.stringify(before)).toContain(NAME_ONE);
    expect((await body(await api.reviews(ADMIN))).items).toEqual([]);
  });
});
