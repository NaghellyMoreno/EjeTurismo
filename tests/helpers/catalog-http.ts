import { createCatalogItemHandler, listCatalogHandler, renameCatalogItemHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import type { CatalogKind } from "@/server/services";
import { testConfig } from "./config";
import { appDb } from "./db";
import { signInitData, tma } from "./telegram";

// Las tres listas de F011: ruta, nombre del parámetro, tabla y manejadores reales con la base de prueba (rol eje_app).
export const LISTS = [
  { kind: "category", path: "categories", param: "categoryId", table: "categories" },
  { kind: "experience_type", path: "experience-types", param: "experienceTypeId", table: "experience_types" },
  { kind: "establishment_type", path: "establishment-types", param: "establishmentTypeId", table: "establishment_types" },
] as const satisfies readonly { kind: CatalogKind; path: string; param: string; table: string }[];
export type ListDef = (typeof LISTS)[number];

type RenameHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function makeCatalogApi(db = appDb()) {
  const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
  const handlers = (list: ListDef) => ({
    list: listCatalogHandler(deps, list.kind),
    create: createCatalogItemHandler(deps, list.kind),
    rename: renameCatalogItemHandler(deps, list.kind, list.param) as RenameHandler,
  });
  return { db, deps, handlers, destroy: () => db.destroy() };
}

// `userId` null: sin cabecera de autorización. `extra` reemplaza la cabecera (firma inválida, etc.).
const headers = (userId: number | null, extra?: Record<string, string>) => ({
  "Content-Type": "application/json",
  ...(extra ?? (userId === null ? {} : tma(signInitData({ userId })))),
});

const bodyOf = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body));

export const listReq = (list: ListDef, userId: number | null, extra?: Record<string, string>) =>
  new Request(`http://localhost/api/v1/${list.path}`, { headers: headers(userId, extra) });

export const createReq = (list: ListDef, userId: number | null, body: unknown, extra?: Record<string, string>) =>
  new Request(`http://localhost/api/v1/${list.path}`, { method: "POST", headers: headers(userId, extra), body: bodyOf(body) });

export const renameReq = (list: ListDef, id: string, userId: number | null, body: unknown, extra?: Record<string, string>) =>
  new Request(`http://localhost/api/v1/${list.path}/${id}`, { method: "PATCH", headers: headers(userId, extra), body: bodyOf(body) });

export const idContext = (list: ListDef, id: string) => ({ params: Promise.resolve({ [list.param]: id }) });
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
