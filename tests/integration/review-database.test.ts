/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type InsertQueryNode, type KyselyPlugin } from "kysely";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { dropDatabase } from "../helpers/drop-database";
import { seedListing } from "../helpers/listing-data";
import { ADMIN, makeReviewListingApi, NAME_ONE, REASON, seedWorld, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F014, criterios 18 y 27: la transacción es atómica, la base impone las transiciones y la migración es aditiva.
let owner: Pool;
let app: Pool;
let world: World;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => {
  owner = ownerPool();
  app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
  await app.end();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

// Un `Db` que lanza al preparar el insert de la tabla indicada (un fallo inyectado a mitad de la transacción).
const failInsertInto = (table: string): KyselyPlugin => ({
  transformQuery: ({ node }) => {
    if (node.kind === "InsertQueryNode" && (node as InsertQueryNode).into?.table.identifier.name === table) throw new Error("fallo-inyectado");
    return node;
  },
  transformResult: async ({ result }) => result,
});

describe("criterio 18: la transacción es atómica", () => {
  it.each(["notification_outbox", "audit_events"])("si falla el insert de %s, la versión sigue pending, sin cambios y con 500 internal_error", async (table) => {
    const failing = appDb();
    const api = makeReviewListingApi(failing.withPlugin(failInsertInto(table)) as never);
    const ok = makeReviewListingApi();
    try {
      const fp = await ok.pending(world, NAME_ONE);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const kind of ["approve", "reject"] as const) {
        const before = await snapshotAll(owner);
        const res = kind === "approve" ? await api.approve(ADMIN, fp.versionId) : await api.reject(ADMIN, fp.versionId);
        const json = (await res.json()) as Record<string, any>;
        expect(res.status, kind).toBe(500);
        expect(json.code).toBe("internal_error");
        expect(JSON.stringify(json)).not.toContain("fallo-inyectado");
        expect(changedTables(before, await snapshotAll(owner)), kind).toEqual([]);
        expect((await rows("select status from app.listing_versions where id = $1", [fp.versionId]))[0].status).toBe("pending");
      }
    } finally {
      await failing.destroy();
      await ok.destroy();
    }
  });
});

describe("criterio 18: la base impone las transiciones con el rol eje_app", () => {
  let adminId: string;
  beforeEach(async () => {
    adminId = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN]))[0].id;
  });
  const seed = (status: "draft" | "pending" | "published" | "rejected") =>
    seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Ficticia", status });
  const update = (set: string, id: string, decidedBy: string | null = adminId) =>
    app.query(`update app.listing_versions set ${set}, decided_by = $2 where id = $1`, [id, decidedBy]);
  const violation = (constraint: string) => ({ code: "23514", constraint });

  it("(a) pending a published sin decided_by: listing_versions_decision_actor", async () => {
    const v = await seed("pending");
    await expect(update("status = 'published'", v.versionId, null)).rejects.toMatchObject(violation("listing_versions_decision_actor"));
  });
  it("(b) pending a published con decided_by de una cuenta sin rol admin (A6): listing_versions_decision_actor", async () => {
    const v = await seed("pending");
    await expect(update("status = 'published'", v.versionId, world.a6Account)).rejects.toMatchObject(violation("listing_versions_decision_actor"));
  });
  it("(c) draft a published: listing_versions_decision_transition", async () => {
    const v = await seed("draft");
    await expect(update("status = 'published'", v.versionId)).rejects.toMatchObject(violation("listing_versions_decision_transition"));
  });
  it("(d) published a rejected con motivo: listing_versions_decision_transition", async () => {
    const v = await seed("published");
    await expect(update("status = 'rejected', rejection_reason = 'Motivo'", v.versionId)).rejects.toMatchObject(violation("listing_versions_decision_transition"));
  });
  it("(e) superseded a published: listing_versions_decision_transition", async () => {
    const v = await seed("published");
    await owner.query("update app.listing_versions set status = 'superseded' where id = $1", [v.versionId]);
    await expect(update("status = 'published'", v.versionId)).rejects.toMatchObject(violation("listing_versions_decision_transition"));
  });
  it("(f) rejected a published: listing_versions_decision_transition", async () => {
    const v = await seed("rejected");
    await expect(update("status = 'published'", v.versionId)).rejects.toMatchObject(violation("listing_versions_decision_transition"));
  });
  it("pending a rejected sin rejection_reason viola el CHECK de F012", async () => {
    const v = await seed("pending");
    await expect(update("status = 'rejected'", v.versionId)).rejects.toMatchObject({ code: "23514", constraint: "listing_versions_rejection_reason_check" });
  });
  it("control positivo: pending a published, pending a rejected con motivo y published a superseded se aceptan", async () => {
    const published = await seed("pending");
    await update("status = 'published'", published.versionId);
    expect((await rows("select status from app.listing_versions where id = $1", [published.versionId]))[0].status).toBe("published");
    await app.query("update app.listing_versions set status = 'superseded' where id = $1", [published.versionId]);
    expect((await rows("select status from app.listing_versions where id = $1", [published.versionId]))[0].status).toBe("superseded");
    const rejected = await seed("pending");
    await update(`status = 'rejected', rejection_reason = '${REASON}'`, rejected.versionId);
    expect((await rows("select status, rejection_reason from app.listing_versions where id = $1", [rejected.versionId]))[0]).toEqual({ status: "rejected", rejection_reason: REASON });
  });
  it("un administrador revocado ya no puede decidir (decided_by con permiso revocado)", async () => {
    const v = await seed("pending");
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'admin'", [ADMIN]);
    await expect(update("status = 'published'", v.versionId)).rejects.toMatchObject(violation("listing_versions_decision_actor"));
  });
});

describe("criterio 27: migración 20261118120000_f014_review.sql", () => {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const NAME = "20261118120000_f014_review.sql";
  const file = readFileSync(resolve(dir, NAME), "utf8");
  const ownerUrl = new URL(process.env.TEST_OWNER_URL!);
  const urlFor = (db: string) => {
    const url = new URL(ownerUrl);
    url.pathname = `/${db}`;
    return url.toString();
  };

  it("existe y es posterior a 20261118100000 (F015 agrega después 20261119100000, D-155)", () => {
    expect(files).toContain(NAME);
    expect(files.indexOf(NAME)).toBe(files.length - 2);
    expect(files[files.length - 1]).toBe("20261119100000_f015_published_guard.sql");
    expect(files[files.indexOf(NAME) - 1]).toBe("20261118100000_f013_establishments.sql");
  });

  it("no contiene drop, alter column ni delete y solo contiene grant, create function y create trigger", () => {
    expect(file).not.toMatch(/\bdrop\b/i);
    expect(file).not.toMatch(/\balter\s+column\b/i);
    expect(file).not.toMatch(/\bdelete\b/i);
    const statements = file
      .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
      // El cuerpo de la función ($$ ... $$) es una sola sentencia `create function`.
      .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
      .split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    for (const statement of statements) expect(statement, statement).toMatch(/^(grant|create function|create trigger)\b/i);
  });

  it("se aplica sobre una base vacía y sobre la ya migrada hasta 20261118100000; eje_app puede actualizar las columnas y existe el disparador", async () => {
    const name = `eje_turismo_test_mig_${randomBytes(4).toString("hex")}`;
    const admin = new Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    try {
      await admin.query(`create database "${name}"`);
      const client = new Client({ connectionString: urlFor(name) });
      await client.connect();
      try {
        for (const f of files.filter((f) => f !== NAME)) await client.query(readFileSync(resolve(dir, f), "utf8"));
        const privilege = (column: string) => client.query("select has_column_privilege('eje_app', 'app.listing_versions', $1, 'UPDATE') as ok", [column]);
        for (const column of ["decided_at", "decided_by", "rejection_reason"]) expect((await privilege(column)).rows[0].ok, `antes: ${column}`).toBe(false);
        await expect(client.query(file)).resolves.toBeDefined();
        for (const column of ["decided_at", "decided_by", "rejection_reason"]) expect((await privilege(column)).rows[0].ok, `después: ${column}`).toBe(true);
        const trigger = await client.query("select tgname from pg_trigger where tgname = 'listing_versions_check_decision' and not tgisinternal");
        expect(trigger.rows).toHaveLength(1);
      } finally {
        await client.end();
      }
    } finally {
      await dropDatabase(admin, name);
      await admin.end();
    }
  });

  it("api/openapi.yaml no cambia", async () => {
    const { execFileSync } = await import("node:child_process");
    expect(execFileSync("git", ["diff", "--stat", "HEAD", "--", "api/openapi.yaml"]).toString()).toBe("");
  });
});
