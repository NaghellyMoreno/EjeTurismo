import { describe, expect, it } from "vitest";
import { assertConsented } from "@/server/auth/consent-guard";
import { AppError } from "@/server/errors";
import type { Deps } from "@/server/http/deps";
import { withConsentGuard } from "@/server/http/handlers";
import type { ConsentState } from "@/server/services";
import { failingDb } from "../helpers/failing-db";
import { BOT_TOKEN, signInitData, tma } from "../helpers/telegram";

const notice = { version: "2026-11-v3", bodyMarkdown: "b", declarationText: "d", revocationNote: null, publishedAt: new Date() };
const account = (acceptedVersion: string) => ({ displayName: "P", acceptedVersion, acceptedAt: new Date(), channel: "bot" as const });
const states: Record<string, ConsentState> = {
  sinCuenta: { notice, account: null, accepted: false },
  versionAnterior: { notice, account: account("2026-10-v1"), accepted: false },
  vigente: { notice, account: account("2026-11-v3"), accepted: true },
};

describe("guardián de consentimiento (criterio 28b; D-039)", () => {
  it("lanza 403 consent_required sin cuenta y con una versión anterior, y deja pasar a la versión vigente", () => {
    for (const name of ["sinCuenta", "versionAnterior"]) {
      try {
        assertConsented(states[name]);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ status: 403, code: "consent_required" });
      }
    }
    expect(() => assertConsented(states.vigente)).not.toThrow();
  });

  // Ruta de ejemplo definida solo aquí: ninguna ruta de F001 usa el guardián.
  const deps: Deps = {
    config: () => ({ botToken: BOT_TOKEN, webhookSecret: "s", databaseUrl: "x", initDataMaxAgeSeconds: 86400 }),
    db: () => failingDb().db,
    now: () => new Date(),
  };
  const exampleRoute = (state: ConsentState) =>
    withConsentGuard(deps, async () => Response.json({ ok: true }), async () => state);
  const request = () => new Request("http://localhost/ejemplo", { headers: tma(signInitData({ userId: 900000002 })) });

  it("la ruta de ejemplo responde 403 consent_required (problem+json) o 200 según el estado", async () => {
    for (const name of ["sinCuenta", "versionAnterior"]) {
      const res = await exampleRoute(states[name])(request());
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect((await res.json()).code).toBe("consent_required");
    }
    expect((await exampleRoute(states.vigente)(request())).status).toBe(200);
  });

  it("sin initData válido responde 401 antes de evaluar el consentimiento", async () => {
    const res = await exampleRoute(states.vigente)(new Request("http://localhost/ejemplo"));
    expect(res.status).toBe(401);
  });
});
