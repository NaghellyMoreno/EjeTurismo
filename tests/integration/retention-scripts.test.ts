import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@/server/storage";
import { ownerPool } from "../helpers/db";
import { PROVIDER_COUNTS, SEEDED_VALUES, WHOLE_TABLES, count, expectedProcessed, restoreRetention, seedRetention, tableCounts } from "../helpers/retention";

// F038, criterio 21: pnpm purge:dry-run y pnpm purge:run, ejecutados como proceso hijo con la base de pruebas.
const owner = ownerPool();
const storage = new MemoryStorage();

const script = (mode: "--dry-run" | "--run", env: Record<string, string | undefined>) => {
  const child = spawnSync(process.execPath, ["scripts/purge.ts", mode], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: child.status, out: `${child.stdout}${child.stderr}`, stdout: child.stdout };
};
// Con el rol de aplicación el script no puede leer retention_settings: debe usarse la conexión del propietario.
const ownerEnv = () => ({ DATABASE_MIGRATIONS_URL: process.env.TEST_OWNER_URL });

beforeEach(async () => {
  await seedRetention(owner, storage);
});
afterAll(async () => {
  await restoreRetention(owner);
  await owner.end();
});

describe("criterio 21: scripts de eliminación", () => {
  it("purge:dry-run informa los conteos por tabla y un total igual a N, sin borrar nada ni exponer datos sembrados", async () => {
    const before = await tableCounts(owner);
    const n = await expectedProcessed(owner);
    const { code, out, stdout } = script("--dry-run", ownerEnv());
    expect(code).toBe(0);
    const lines = new Map([...stdout.matchAll(/^ {2}(\w+): (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
    for (const table of WHOLE_TABLES) expect(lines.get(table), table).toBe(before[table]);
    for (const [table, query] of Object.entries(PROVIDER_COUNTS)) expect(lines.get(table), table).toBe(Number((await owner.query(query)).rows[0].count));
    expect(stdout).toContain(`Total: ${n}`);
    for (const value of SEEDED_VALUES) expect(out, value).not.toContain(value);
    expect(await tableCounts(owner)).toEqual(before);
  });

  it("purge:dry-run no usa la conexión de eje_app", () => {
    const { code } = script("--dry-run", { DATABASE_MIGRATIONS_URL: process.env.TEST_APP_URL });
    expect(code).not.toBe(0);
  });

  it("purge:run ejecuta la eliminación contra la base de pruebas y su total es N", async () => {
    const n = await expectedProcessed(owner);
    const { code, stdout } = script("--run", ownerEnv());
    expect(code).toBe(0);
    expect(stdout).toContain(`Total: ${n}`);
    expect(await count(owner, "accounts")).toBe(0);
    expect((await owner.query("select executed_at from app.retention_settings")).rows[0].executed_at).not.toBeNull();
  });

  it("purge:run con NODE_ENV=production sale con error y no cambia ninguna tabla", async () => {
    const before = await tableCounts(owner);
    const { code, out } = script("--run", { ...ownerEnv(), NODE_ENV: "production" });
    expect(code).not.toBe(0);
    expect(out).toContain("NODE_ENV=production");
    expect(await tableCounts(owner)).toEqual(before);
    expect((await owner.query("select executed_at from app.retention_settings")).rows[0].executed_at).toBeNull();
  });
});
