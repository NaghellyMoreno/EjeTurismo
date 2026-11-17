import { defaultDeps } from "@/server/http/deps";
import { createCatalogItemHandler, listCatalogHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listCatalogHandler(defaultDeps, "experience_type");
export const POST = createCatalogItemHandler(defaultDeps, "experience_type");
