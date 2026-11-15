import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool as AppPool } from "pg";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { readNoticeSource } from "../helpers/notice-source";

let owner: Pool;
beforeAll(() => void (owner = ownerPool()));
afterAll(() => owner.end());
beforeEach(() => resetDb(owner));

describe("semilla del aviso (criterio 2)", () => {
  it("la semilla cargada es el texto de docs/05-aviso-privacidad.md sin marcas y sin cambios de redacción", async () => {
    const source = readNoticeSource();
    const { rows } = await owner.query("select * from app.privacy_notice_versions");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: NOTICE_VERSION,
      is_current: true,
      body_markdown: source.body,
      declaration_text: source.declaration,
      revocation_note: source.revocationNote,
    });
    expect(rows[0].body_markdown).toContain("[fecha de publicación en producción]");
    expect(rows[0].body_markdown).not.toMatch(/\[(Confirmado|Inferido|Pendiente)/);
  });
});

describe("una sola versión vigente (criterio 20)", () => {
  it("insertar una segunda fila con is_current=true falla por el índice único parcial", async () => {
    await expect(
      owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-12-v1', 'b', 'd', true)"),
    ).rejects.toMatchObject({ code: "23505", constraint: "privacy_notice_versions_one_current" });
    await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-12-v1', 'b', 'd', false)");
  });
});

describe("consent_events sin identificador de la persona (criterio 18; D-036)", () => {
  it("solo tiene evento, canal, versión y fecha: ni ID de Telegram, ni pseudónimo, ni cuenta, ni número de identidad", async () => {
    const { rows } = await owner.query(
      "select column_name from information_schema.columns where table_schema = 'app' and table_name = 'consent_events' order by ordinal_position",
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toEqual(["id", "event", "channel", "notice_version", "occurred_at"]);
    for (const column of columns) expect(column).not.toMatch(/telegram|account|user|pseud|hash|hmac|identity|document/i);
  });

  it("eje_app puede INSERT y SELECT pero no UPDATE ni DELETE", async () => {
    const app = new AppPool({ connectionString: process.env.TEST_APP_URL, max: 1 });
    try {
      await app.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', $1)", [NOTICE_VERSION]);
      expect((await app.query("select count(*) from app.consent_events")).rows[0].count).toBe("1");
      await expect(app.query("update app.consent_events set channel = 'mini_app'")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("delete from app.consent_events")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("truncate app.consent_events")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
  });

  it("eje_app no puede modificar las versiones del aviso", async () => {
    const app = new AppPool({ connectionString: process.env.TEST_APP_URL, max: 1 });
    try {
      await expect(app.query("update app.privacy_notice_versions set body_markdown = 'x'")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text) values ('x','b','d')")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
  });

  it("anon, authenticated y service_role no tienen acceso al esquema app (ADR 0006)", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await owner.query("select has_schema_privilege($1, 'app', 'usage') as usage", [role]);
      expect(rows[0].usage).toBe(false);
    }
  });
});
