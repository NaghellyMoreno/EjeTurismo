import { createListingHandler, listPublishedListingsHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "./config";
import { appDb } from "./db";
import { signInitData, tma } from "./telegram";

export * from "./attraction-data";

export function makeAttractionApi(db = appDb()) {
  const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
  const create = createListingHandler(deps);
  const list = listPublishedListingsHandler(deps);
  const headersOf = (userId: number | null, extra?: Record<string, string>) => extra ?? (userId === null ? {} : tma(signInitData({ userId })));
  return {
    db,
    deps,
    createAs: (userId: number | null, body: unknown, extra?: Record<string, string>) =>
      create(
        new Request("http://localhost/api/v1/managed-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headersOf(userId, extra) },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
    listAs: (userId: number | null, query = "", extra?: Record<string, string>) =>
      list(new Request(`http://localhost/api/v1/public/listings${query ? `?${query}` : ""}`, { headers: headersOf(userId, extra) })),
    destroy: () => db.destroy(),
  };
}
