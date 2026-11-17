import { defaultDeps } from "@/server/http/deps";
import { createMunicipalityHandler, listMunicipalitiesHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listMunicipalitiesHandler(defaultDeps);
export const POST = createMunicipalityHandler(defaultDeps);
