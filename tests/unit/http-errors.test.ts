import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deps } from "@/server/http/deps";
import { acceptPrivacyNoticeHandler, getCurrentPrivacyNoticeHandler, getMeHandler } from "@/server/http/handlers";
import { testConfig } from "../helpers/config";
import { validateSchema } from "../helpers/openapi";
import { failingDb } from "../helpers/failing-db";
import { signInitData, tma } from "../helpers/telegram";

afterEach(() => vi.restoreAllMocks());

const now = new Date("2026-11-15T12:00:00Z");
const authDate = Math.floor(now.getTime() / 1000);

function setup() {
  const fake = failingDb("fallo-interno-secreto");
  const deps: Deps = {
    config: () => testConfig(),
    db: () => fake.db,
    now: () => now,
  };
  return { fake, deps };
}

const get = (headers: Record<string, string> = {}) => new Request("http://localhost/api/v1/me", { headers });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/consents", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const valid = () => tma(signInitData({ userId: 900000001, authDate }));

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = await res.json();
  expect(body.code).toBe(code);
  expect(validateSchema("Problem", body)).toEqual([]);
  return body;
}

describe("401 sin consultar la base (criterio 31; ADR 0003, 0006)", () => {
  const badHeaders: Record<string, Record<string, string>> = {
    "sin Authorization": {},
    "firma inválida": tma(signInitData({ userId: 900000001, authDate, token: "999:otro" })),
    "auth_date vencido": tma(signInitData({ userId: 900000001, authDate: authDate - 86401 })),
    "esquema distinto": { Authorization: "Bearer algo" },
  };
  for (const [name, headers] of Object.entries(badHeaders)) {
    it(`getMe y acceptPrivacyNotice responden 401 ${name}`, async () => {
      const { fake, deps } = setup();
      await expectProblem(await getMeHandler(deps)(get(headers)), 401, "unauthenticated");
      await expectProblem(await acceptPrivacyNoticeHandler(deps)(post({ noticeVersion: "2026-11-v3", accepted: true }, headers)), 401, "unauthenticated");
      expect(fake.queries).toEqual([]);
    });
  }
});

describe("validación del cuerpo de acceptPrivacyNotice (criterios 32, 39, 40)", () => {
  const invalidBodies: Record<string, unknown> = {
    "accepted=false": { noticeVersion: "2026-11-v3", accepted: false },
    "sin noticeVersion": { accepted: true },
    "sin accepted": { noticeVersion: "2026-11-v3" },
    "noticeVersion vacío": { noticeVersion: "", accepted: true },
    "noticeVersion null": { noticeVersion: null, accepted: true },
    "noticeVersion numérico": { noticeVersion: 3, accepted: true },
    "noticeVersion objeto": { noticeVersion: { v: 1 }, accepted: true },
    "campo desconocido": { noticeVersion: "2026-11-v3", accepted: true, admin: true },
    "JSON no válido": "{no es json",
  };
  for (const [name, body] of Object.entries(invalidBodies)) {
    it(`responde 422 validation_failed con ${name} y no consulta la base`, async () => {
      const { fake, deps } = setup();
      const res = await acceptPrivacyNoticeHandler(deps)(post(body, valid()));
      const problem = await expectProblem(res, 422, "validation_failed");
      expect(problem.errors?.length).toBeGreaterThan(0);
      expect(fake.queries).toEqual([]);
    });
    it(`responde 401 y no 422 con ${name} si no hay initData válido (el 401 va primero)`, async () => {
      const { fake, deps } = setup();
      await expectProblem(await acceptPrivacyNoticeHandler(deps)(post(body)), 401, "unauthenticated");
      await expectProblem(await acceptPrivacyNoticeHandler(deps)(post(body, tma(signInitData({ userId: 1, authDate, token: "9:x" })))), 401, "unauthenticated");
      expect(fake.queries).toEqual([]);
    });
  }
});

describe("500 sin detalles internos (criterio 37; ADR 0006)", () => {
  it("getCurrentPrivacyNotice y getMe responden 500 problem+json genérico", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fake, deps } = setup();
    const responses = [await getCurrentPrivacyNoticeHandler(deps)(), await getMeHandler(deps)(get(valid()))];
    for (const res of responses) {
      const text = await res.clone().text();
      await expectProblem(res, 500, "internal_error");
      for (const leaked of [fake.errorText, "accounts", "privacy_notice_versions", "select", "stack", " at "]) {
        expect(text.toLowerCase()).not.toContain(leaked.toLowerCase());
      }
    }
    expect(fake.queries.length).toBeGreaterThan(0);
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(fake.errorText);
  });
});
