import { describe, expect, it } from "vitest";
import type { Deps } from "@/server/http/deps";
import { withProviderGuard } from "@/server/http/handlers";
import { testConfig } from "../helpers/config";
import { failingDb } from "../helpers/failing-db";
import { signInitData, tma } from "../helpers/telegram";

// Criterio 24: sin Authorization o con firma inválida, el guardián responde 401 sin consultar la base.
describe("guardián de rol provider sin sesión (criterio 24)", () => {
  it("responde 401 sin Authorization o con firma inválida y no consulta la base", async () => {
    const fake = failingDb();
    const deps: Deps = { config: () => testConfig(), db: () => fake.db, now: () => new Date() };
    const route = withProviderGuard(deps, async () => Response.json({ ok: true }));
    const requests = [
      new Request("http://localhost/ejemplo"),
      new Request("http://localhost/ejemplo", { headers: tma(signInitData({ userId: 900000011, token: "9:otro" })) }),
      new Request("http://localhost/ejemplo", { headers: tma(signInitData({ userId: 900000011, tamperUserId: 900000012 })) }),
    ];
    for (const request of requests) {
      const res = await route(request);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
    }
    expect(fake.queries).toEqual([]);
  });
});
