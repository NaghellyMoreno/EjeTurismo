import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acceptPrivacyNotice } from "@/server/services";
import { appDb, counts, NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { ACCEPTING_USER } from "../helpers/telegram";

let owner: Pool;
let dir: string;
const db = appDb();
beforeAll(() => {
  owner = ownerPool();
  dir = mkdtempSync(join(tmpdir(), "aviso-"));
  writeFileSync(join(dir, "cuerpo.md"), "**Aviso nuevo, versión 2026-12-v1.**\n\n### 1. Quién trata tus datos\nTexto de prueba.\n");
  writeFileSync(join(dir, "declaracion.md"), "Declaración de prueba.\n");
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await owner.end();
  await db.destroy();
});
beforeEach(() => resetDb(owner));

function publish(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/notice-publish.ts", ...args], {
    env: { ...process.env, DATABASE_MIGRATIONS_URL: process.env.TEST_OWNER_URL },
    encoding: "utf8",
  });
}
const files = () => ["--body", join(dir, "cuerpo.md"), "--declaration", join(dir, "declaracion.md")];

describe("pnpm notice:publish (criterio 24; D-025)", () => {
  it("deja vigente solo la versión nueva y no borra la anterior ni sus pruebas de aceptación", async () => {
    await acceptPrivacyNotice(db, { telegramUserId: String(ACCEPTING_USER), displayName: "P" }, { noticeVersion: NOTICE_VERSION, channel: "bot" });
    const result = publish("--version", "2026-12-v1", ...files());
    expect(result.status, result.stderr).toBe(0);

    const { rows } = await owner.query("select version, is_current from app.privacy_notice_versions order by version");
    expect(rows).toEqual([
      { version: NOTICE_VERSION, is_current: false },
      { version: "2026-12-v1", is_current: true },
    ]);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1 });
    expect((await owner.query("select notice_version from app.consent_events")).rows).toEqual([{ notice_version: NOTICE_VERSION }]);
    expect((await owner.query("select body_markdown from app.privacy_notice_versions where is_current")).rows[0].body_markdown).toContain("Aviso nuevo");
  });

  it("rechaza una versión repetida o con formato inválido sin cambiar nada", async () => {
    const duplicate = publish("--version", NOTICE_VERSION, ...files());
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("ya existe");
    expect(publish("--version", "nueva", ...files()).status).toBe(1);
    expect(publish("--version", "2026-12-v1").status).toBe(1);
    const { rows } = await owner.query("select version, is_current from app.privacy_notice_versions");
    expect(rows).toEqual([{ version: NOTICE_VERSION, is_current: true }]);
  });
});
