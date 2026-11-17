import { defaultDeps } from "@/server/http/deps";
import { updateMunicipalityHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const PATCH = updateMunicipalityHandler(defaultDeps);
