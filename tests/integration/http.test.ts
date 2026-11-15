import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as consentsPost } from "@/app/api/v1/consents/route";
import { GET as meGet } from "@/app/api/v1/me/route";
import { GET as noticeGet } from "@/app/api/v1/privacy-notices/current/route";
import { POST as webhookPost } from "@/app/api/v1/telegram/webhook/route";
import { counts, EMPTY_COUNTS, NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { validateSchema } from "../helpers/openapi";
import { ACCEPTING_USER, NEW_USER, OLD_VERSION_USER, signInitData, tma } from "../helpers/telegram";

// Las rutas reales, con DATABASE_URL apuntando a la base temporal y el rol eje_app (ver tests/helpers/db-env.ts).
let owner: Pool;
beforeAll(() => void (owner = ownerPool()));
afterAll(() => owner.end());
beforeEach(() => resetDb(owner));

const meRequest = (userId: number) => new Request("http://localhost/api/v1/me", { headers: tma(signInitData({ userId })) });
const acceptRequest = (userId: number, body: unknown = { noticeVersion: NOTICE_VERSION, accepted: true }) =>
  new Request("http://localhost/api/v1/consents", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tma(signInitData({ userId, firstName: "Persona Prueba Dos" })) },
    body: JSON.stringify(body),
  });
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("GET /api/v1/privacy-notices/current (criterios 5 y 6)", () => {
  it("sin Authorization responde 200 con el aviso vigente, valida contra el contrato y no escribe", async () => {
    const res = await noticeGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateSchema("PrivacyNotice", body)).toEqual([]);
    expect(body).toMatchObject({ version: NOTICE_VERSION });
    expect(body.bodyMarkdown).toContain("### 13.");
    expect(body.declarationText).toMatch(/^Leí el aviso de privacidad de Eje Turismo, versión 2026-11-v3/);
    expect(body.revocationNote).toMatch(/^El número de identidad se usa solo/);
    expect(body.publishedAt).toMatch(ISO_UTC);
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });

  it("sin ninguna versión vigente responde 404 problem+json", async () => {
    await owner.query("update app.privacy_notice_versions set is_current = false");
    const res = await noticeGet();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(validateSchema("Problem", body)).toEqual([]);
    expect(body.code).toBe("not_found");
  });
});

describe("GET /api/v1/me (criterios 19, 22, 23, 28a)", () => {
  it("de un ID sin cuenta: required=true, sin nombre ni roles, y no crea filas", async () => {
    const res = await meGet(meRequest(NEW_USER));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateSchema("Me", body)).toEqual([]);
    expect(body).toMatchObject({ displayName: null, roles: [], consent: { required: true, acceptedVersion: null, acceptedAt: null } });
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });

  it("de una cuenta aceptada: required=false, versión y acceptedAt en ISO UTC", async () => {
    expect((await consentsPost(acceptRequest(ACCEPTING_USER))).status).toBe(201);
    const body = await (await meGet(meRequest(ACCEPTING_USER))).json();
    expect(validateSchema("Me", body)).toEqual([]);
    expect(body).toMatchObject({ roles: [], consent: { required: false, acceptedVersion: NOTICE_VERSION } });
    expect(body.consent.acceptedAt).toMatch(ISO_UTC);
  });

  it("de una cuenta con versión anterior, con la versión nueva publicada: required=true y acceptedVersion anterior", async () => {
    await consentsPost(acceptRequest(OLD_VERSION_USER));
    await owner.query("update app.privacy_notice_versions set is_current = false");
    await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-12-v1', 'b', 'd', true)");
    const body = await (await meGet(meRequest(OLD_VERSION_USER))).json();
    expect(body.consent).toMatchObject({ required: true, acceptedVersion: NOTICE_VERSION, currentVersion: "2026-12-v1" });
  });
});

describe("POST /api/v1/consents (criterios 12, 13, 16)", () => {
  it("responde 201 con Me, registra canal mini_app y es idempotente", async () => {
    const first = await consentsPost(acceptRequest(ACCEPTING_USER));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(validateSchema("Me", firstBody)).toEqual([]);
    expect(firstBody.consent).toMatchObject({ required: false, acceptedVersion: NOTICE_VERSION });

    const second = await consentsPost(acceptRequest(ACCEPTING_USER));
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(firstBody);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1 });
    expect((await owner.query("select channel, notice_version from app.consent_events")).rows).toEqual([{ channel: "mini_app", notice_version: NOTICE_VERSION }]);
  });

  it("con una versión no vigente responde 409 notice_version_outdated y no crea nada", async () => {
    const res = await consentsPost(acceptRequest(NEW_USER, { noticeVersion: "2026-10-vX", accepted: true }));
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(validateSchema("Problem", body)).toEqual([]);
    expect(body.code).toBe("notice_version_outdated");
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });

  it("una cadena no vacía que no es la vigente da 409 y no 422; vacío, null, número u objeto dan 422 sin crear nada", async () => {
    expect((await consentsPost(acceptRequest(NEW_USER, { noticeVersion: "x", accepted: true }))).status).toBe(409);
    for (const noticeVersion of ["", null, 3, { v: 1 }]) {
      const res = await consentsPost(acceptRequest(NEW_USER, { noticeVersion, accepted: true }));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("validation_failed");
    }
    expect((await consentsPost(acceptRequest(NEW_USER, { noticeVersion: NOTICE_VERSION, accepted: false }))).status).toBe(422);
    expect((await consentsPost(acceptRequest(NEW_USER, { accepted: true }))).status).toBe(422);
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });

  it("el 401 va antes que el 422 con la base real", async () => {
    const bad = (headers: Record<string, string>) =>
      consentsPost(new Request("http://localhost/api/v1/consents", { method: "POST", headers, body: JSON.stringify({ accepted: false }) }));
    expect((await bad({})).status).toBe(401);
    expect((await bad(tma(signInitData({ userId: NEW_USER, token: "9:otro" })))).status).toBe(401);
    expect((await bad(tma(signInitData({ userId: NEW_USER })))).status).toBe(422);
  });
});

describe("POST /api/v1/telegram/webhook (criterio 29)", () => {
  it("la ruta real responde 401 sin la cabecera del secreto o con una distinta, sin tocar la base", async () => {
    const body = JSON.stringify({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: NEW_USER, type: "private" }, from: { id: NEW_USER, is_bot: false, first_name: "P" }, text: "/start" } });
    const wrong: Record<string, string>[] = [{}, { "X-Telegram-Bot-Api-Secret-Token": "otro" }];
    for (const headers of wrong) {
      const res = await webhookPost(new Request("http://localhost/api/v1/telegram/webhook", { method: "POST", headers, body }));
      expect(res.status).toBe(401);
    }
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });
});
