import { defaultDeps } from "@/server/http/deps";
import { renameCatalogItemHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const PATCH = renameCatalogItemHandler(defaultDeps, "category", "categoryId");
