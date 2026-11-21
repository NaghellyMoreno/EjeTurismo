/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderRegistrationHandler } from "@/server/http/handlers";
import { testConfig } from "../helpers/config";
import { ownerPool } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { createRequest, registration } from "../helpers/http";
import { expectNoIdentity, IDS, N1_NUMBER, N1_TYPE, seedIdentityWorld, watchConsole, type IdentityWorld } from "../helpers/identity-leak";
import { makeReviewListingApi } from "../helpers/review-listing";
import { signInitData, tma } from "../helpers/telegram";

// F027, criterios 11, 12 y 15: los errores de createProviderRegistration con N1 en el cuerpo no repiten el número.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let w: IdentityWorld;
let consoleWatch: ReturnType<typeof watchConsole>;
const api = makeReviewListingApi();
const create = createProviderRegistrationHandler(api.deps);

async function problemOf(res: Response, label: string): Promise<any> {
  expect(res.headers.get("content-type"), label).toContain("application/problem+json");
  const text = await res.text();
  expectNoIdentity(text, w.secrets, label, true);
  const body = JSON.parse(text);
  for (const field of [body.type, body.title, body.detail, ...(body.errors ?? []).flatMap((e: any) => [e.field, e.code, e.message])]) {
    if (typeof field === "string") expectNoIdentity(field, w.secrets, `${label} campo`, true);
  }
  return body;
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  w = await seedIdentityWorld(owner, api, afterTasks);
  consoleWatch = watchConsole();
});
afterEach(() => {
  consoleWatch.expectClean(w.secrets);
  vi.restoreAllMocks();
});

describe("criterio 11: errores de createProviderRegistration con N1 en el cuerpo", () => {
  it("duplicado por documento: 409 duplicate de otra cuenta con aviso", async () => {
    const res = await create(createRequest(IDS.rateLimited, registration(N1_TYPE, N1_NUMBER)));
    expect(res.status).toBe(409);
    expect((await problemOf(res, "duplicado")).code).toBe("duplicate");
  });

  it("cuenta ya registrada: 409 duplicate (la cuenta de P1 envía otro tipo con N1)", async () => {
    for (const body of [registration(N1_TYPE, N1_NUMBER), registration("PPT", N1_NUMBER), registration("CE", ` ${N1_NUMBER.slice(0, 5)} ${N1_NUMBER.slice(5)} `)]) {
      const res = await create(createRequest(IDS.p1, body));
      expect(res.status).toBe(409);
      expect((await problemOf(res, "ya registrada")).code).toBe("duplicate");
    }
  });

  it("formato inválido: 422 con códigos invalid_format, not_in_list, too_long y required, sin repetir N1", async () => {
    const cases: Array<[string, unknown, string]> = [
      ["tipo fuera de la lista", registration("TI", N1_NUMBER), "not_in_list"],
      ["carácter de control", registration(N1_TYPE, `${N1_NUMBER}\u0000`), "invalid_format"],
      ["demasiado largo", registration(N1_TYPE, N1_NUMBER.repeat(500)), "too_long"],
      ["sin confirmar", { identityDocumentType: N1_TYPE, identityNumber: N1_NUMBER }, "required"],
      ["campo desconocido", { ...registration(N1_TYPE, ""), [`campo${N1_NUMBER}`]: N1_NUMBER }, ""],
    ];
    for (const [label, body, code] of cases) {
      const res = await create(createRequest(IDS.rateLimited, body));
      expect(res.status, label).toBe(422);
      const problem = await problemOf(res, label);
      expect(problem.code, label).toBe("validation_failed");
      if (code) expect(problem.errors.map((e: any) => e.code), label).toContain(code);
    }
    const required = await create(createRequest(IDS.rateLimited, { ...registration(N1_TYPE, ""), nota: N1_NUMBER }));
    expect(required.status).toBe(422);
    await problemOf(required, "required");
  });

  it("sin aviso aceptado: 403 consent_required", async () => {
    const res = await create(createRequest(IDS.v0, registration(N1_TYPE, N1_NUMBER)));
    expect(res.status).toBe(403);
    expect((await problemOf(res, "sin aviso")).code).toBe("consent_required");
  });

  it("sin sesión y con initData alterado: 401", async () => {
    for (const headers of [{}, tma(signInitData({ userId: IDS.rateLimited, tamperUserId: IDS.p2 }))]) {
      const res = await create(createRequest(IDS.rateLimited, registration(N1_TYPE, N1_NUMBER), headers));
      expect(res.status).toBe(401);
      await problemOf(res, "401");
    }
  });

  it("límite de intentos: 429 rate_limited al superar el límite configurado de provider_registration", async () => {
    const { limit } = testConfig().rateLimits.provider_registration;
    expect(limit).toBeGreaterThan(0);
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i <= limit; i++) {
      last = await create(createRequest(IDS.rateLimited, registration(N1_TYPE, N1_NUMBER)));
      statuses.push(last.status);
      if (i < limit) await problemOf(last.clone(), `intento ${i + 1}`);
    }
    expect(statuses).toEqual([...Array(limit).fill(409), 429]);
    expect((await problemOf(last!, "429")).code).toBe("rate_limited");
  });
});

describe("criterio 12: fallo interno de la base al registrar con N1", () => {
  it("500 genérico sin el mensaje interno ni N1, también en los registros técnicos", async () => {
    const fake = failingDb(`fallo con ${N1_NUMBER} ${N1_TYPE}${N1_NUMBER} en provider_registrations`);
    const route = createProviderRegistrationHandler({ ...api.deps, db: () => fake.db });
    const res = await route(createRequest(IDS.rateLimited, registration(N1_TYPE, N1_NUMBER)));
    expect(res.status).toBe(500);
    const problem = await problemOf(res, "500");
    expect(problem.code).toBe("internal_error");
    expect(JSON.stringify(problem)).not.toContain("fallo con");
    // El espía de console vio las líneas del fallo (criterio 15) y ninguna lleva N1.
    expect(consoleWatch.lines.length).toBeGreaterThan(0);
    consoleWatch.expectClean(w.secrets);
  });
});
