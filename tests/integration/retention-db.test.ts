import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@/server/storage";
import { ownerPool } from "../helpers/db";
import { ALL_TABLES, count, restoreRetention, seedRetention, setDeadline, tableCounts, todayInBogota } from "../helpers/retention";

// F038, criterios 1, 16, 17, 19 y 20: la función de la base de datos, con datos en todas las tablas.
const owner = ownerPool();
const storage = new MemoryStorage();
const purgeAt = async (instant: string) => (await owner.query("select app.purge_personal_data_at($1::timestamptz) as r", [instant])).rows[0].r as { executed: boolean; skippedReason: string | null };
const executedAt = async () => (await owner.query("select executed_at from app.retention_settings")).rows[0].executed_at as Date | null;

afterAll(async () => {
  await restoreRetention(owner);
  await owner.end();
});
beforeEach(async () => {
  await seedRetention(owner, storage);
});

describe("criterio 1: base sembrada", () => {
  it("cada tabla del alcance y de lo conservado tiene al menos una fila antes de ejecutar", async () => {
    const counts = await tableCounts(owner);
    for (const table of ALL_TABLES) expect(counts[table], table).toBeGreaterThan(0);
    expect(await count(owner, "retention_settings")).toBe(1);
  });
});

describe("criterio 16: la fecha es la de America/Bogota", () => {
  it("23:30 del 30 de enero en Bogotá (fecha UTC ya 31): no ejecuta y no borra nada", async () => {
    await owner.query("update app.retention_settings set deadline = '2027-01-31'");
    const before = await tableCounts(owner);
    const result = await purgeAt("2027-01-31T04:30:00Z");
    expect(result).toMatchObject({ executed: false, skippedReason: "retention_deadline_not_reached" });
    expect(await executedAt()).toBeNull();
    expect(await tableCounts(owner)).toEqual(before);
  });

  it("00:30 del 31 de enero en Bogotá: ejecuta", async () => {
    await owner.query("update app.retention_settings set deadline = '2027-01-31'");
    const result = await purgeAt("2027-01-31T05:30:00Z");
    expect(result.executed).toBe(true);
    expect(await executedAt()).not.toBeNull();
    expect(await count(owner, "accounts")).toBe(0);
  });
});

describe("criterio 17: después del plazo", () => {
  it("con el plazo de ayer y sin ejecutar, ejecuta", async () => {
    const today = await todayInBogota(owner);
    await owner.query("update app.retention_settings set deadline = ($1::date - 1)", [today]);
    expect((await purgeAt(new Date().toISOString())).executed).toBe(true);
    expect(await count(owner, "accounts")).toBe(0);
  });
});

describe("criterio 19: una sola transacción", () => {
  it("si falla a mitad, no se borra nada y executed_at sigue nulo; sin el fallo, ejecuta", async () => {
    await setDeadline(owner, await todayInBogota(owner));
    const before = await tableCounts(owner);
    await owner.query("create function app.f038_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo inyectado'; end $$");
    await owner.query("create trigger f038_fail before delete on app.accounts for each row execute function app.f038_fail()");
    try {
      await expect(purgeAt(new Date().toISOString())).rejects.toThrow(/fallo inyectado/);
      expect(await tableCounts(owner)).toEqual(before);
      expect(await executedAt()).toBeNull();
      // La guarda de fotos suspendida dentro de la función vuelve a estar activa tras deshacer.
      expect((await owner.query("select tgenabled from pg_trigger where tgname = 'listing_photos_guard'")).rows[0].tgenabled).toBe("O");
    } finally {
      await owner.query("drop trigger f038_fail on app.accounts");
      await owner.query("drop function app.f038_fail()");
    }
    expect((await purgeAt(new Date().toISOString())).executed).toBe(true);
    expect(await count(owner, "accounts")).toBe(0);
  });
});

describe("criterio 20: permisos de eje_app", () => {
  const app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 1 });
  afterAll(async () => {
    await app.end();
  });

  it("no lee ni modifica retention_settings y solo ejecuta app.purge_personal_data()", async () => {
    const priv = async (text: string) => (await app.query(text)).rows[0].p as boolean;
    for (const op of ["select", "insert", "update", "delete"]) expect(await priv(`select has_table_privilege('eje_app', 'app.retention_settings', '${op}') as p`), op).toBe(false);
    expect(await priv("select has_function_privilege('eje_app', 'app.purge_personal_data()', 'execute') as p")).toBe(true);
    expect(await priv("select has_function_privilege('eje_app', 'app.purge_personal_data_at(timestamptz)', 'execute') as p")).toBe(false);
    await expect(app.query("select * from app.retention_settings")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update app.retention_settings set deadline = current_date")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("select app.purge_personal_data_at(now())")).rejects.toMatchObject({ code: "42501" });
    expect(await count(owner, "accounts")).toBeGreaterThan(0);
  });

  it("app.purge_personal_data() antes del plazo no borra nada", async () => {
    const before = await tableCounts(owner);
    expect((await app.query("select app.purge_personal_data() as r")).rows[0].r).toMatchObject({ executed: false, skippedReason: "retention_deadline_not_reached" });
    expect(await tableCounts(owner)).toEqual(before);
  });
});
