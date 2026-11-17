import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { dropDatabase } from "../helpers/drop-database";

// Criterio 40 de F034: la migración f034_self_revocation se aplica sobre una base limpia y sobre una con datos de F001 a F006.
const MIGRATION = "f034_self_revocation";
const dir = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const f034 = files.find((f) => f.includes(MIGRATION))!;
const owner = new URL(process.env.TEST_OWNER_URL!);
const urlFor = (db: string) => {
  const url = new URL(owner);
  url.pathname = `/${db}`;
  return url.toString();
};
const created: string[] = [];

async function newDb(): Promise<Client> {
  const name = `eje_turismo_test_mig_${randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  await admin.query(`create database "${name}"`);
  await admin.end();
  created.push(name);
  const client = new Client({ connectionString: urlFor(name) });
  await client.connect();
  return client;
}

const apply = async (client: Client, names: string[]) => {
  for (const file of names) await client.query(readFileSync(resolve(dir, file), "utf8"));
};

afterAll(async () => {
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  try {
    for (const name of created) await dropDatabase(admin, name);
  } finally {
    await admin.end();
  }
});

describe("migración f034_self_revocation (criterio 40)", () => {
  it("existe el archivo de la migración", () => {
    expect(f034).toBeDefined();
  });

  it("se aplica sobre una base limpia", async () => {
    const client = await newDb();
    try {
      await expect(apply(client, files)).resolves.toBeUndefined();
    } finally {
      await client.end();
    }
  });

  it("se aplica sobre una base con datos de F001 a F006 sin cambiar esas filas", async () => {
    const client = await newDb();
    try {
      await apply(client, files.filter((f) => f !== f034));
      await client.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('v1', 'b', 'd', true)");
      const account = (
        await client.query(
          "insert into app.accounts (telegram_user_id, consent_notice_version, consent_accepted_at, consent_channel) values (900000071, 'v1', now(), 'bot') returning id",
        )
      ).rows[0].id;
      const registration = (
        await client.query(
          "insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status) values ($1, 'CC', '\\x00', decode(md5('x'), 'hex'), 'approved') returning id",
          [account],
        )
      ).rows[0].id;
      await client.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values (900000071, 'provider', $1)", [registration]);
      await client.query("insert into app.bot_sessions (account_id, data) values ($1, '{}')", [account]);
      await client.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', 'v1')");
      await client.query("insert into app.audit_events (actor_role, action, entity_type, entity_id) values ('admin', 'x', 'y', $1)", [registration]);
      const tables = ["accounts", "provider_registrations", "role_grants", "bot_sessions", "consent_events", "audit_events"];
      const snapshot = async () => {
        const out: Record<string, string> = {};
        for (const t of tables) out[t] = (await client.query(`select coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '') as s from app.${t} t`)).rows[0].s;
        return out;
      };
      const before = await snapshot();
      await apply(client, [f034]);
      expect(await snapshot()).toEqual(before);
    } finally {
      await client.end();
    }
  });
});

// Criterio 42 de F035: la migración f035_self_revocation_roles se aplica sobre una base limpia y sobre una sembrada por F001 a F034.
const f035 = files.find((f) => f.includes("f035_self_revocation_roles"))!;

describe("migración f035_self_revocation_roles (criterio 42)", () => {
  it("existe el archivo de la migración y es posterior a la de F034", () => {
    expect(f035).toBeDefined();
    expect(f035 > f034).toBe(true);
  });

  it("se aplica sobre una base limpia", async () => {
    const client = await newDb();
    try {
      await expect(apply(client, files)).resolves.toBeUndefined();
    } finally {
      await client.end();
    }
  });

  it("se aplica sobre una base sembrada por F001 a F034 sin cambiar esas filas", async () => {
    const client = await newDb();
    try {
      await apply(client, files.filter((f) => f <= f034));
      await client.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('v1', 'b', 'd', true)");
      const account = (
        await client.query(
          "insert into app.accounts (telegram_user_id, consent_notice_version, consent_accepted_at, consent_channel) values (900000071, 'v1', now(), 'bot') returning id",
        )
      ).rows[0].id;
      const registration = (
        await client.query(
          "insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status) values ($1, 'CC', '\\x00', decode(md5('x'), 'hex'), 'approved') returning id",
          [account],
        )
      ).rows[0].id;
      await client.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values (900000071, 'provider', $1)", [registration]);
      await client.query("insert into app.role_grants (telegram_user_id, role) values (900000072, 'admin')");
      await client.query("insert into app.bot_sessions (account_id, data) values ($1, '{}')", [account]);
      await client.query("insert into app.notification_outbox (recipient_telegram_user_id, template) values (900000071, 'registration_approved')");
      await client.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', 'v1')");
      await client.query("insert into app.audit_events (actor_account_id, actor_role, action, entity_type, entity_id) values ($1, 'admin', 'x', 'y', $2)", [account, registration]);
      const tables = ["accounts", "provider_registrations", "role_grants", "bot_sessions", "notification_outbox", "consent_events", "audit_events"];
      const snapshot = async () => {
        const out: Record<string, string> = {};
        for (const t of tables) out[t] = (await client.query(`select coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '') as s from app.${t} t`)).rows[0].s;
        return out;
      };
      const before = await snapshot();
      await apply(client, files.filter((f) => f > f034));
      expect(await snapshot()).toEqual(before);
    } finally {
      await client.end();
    }
  });
});
