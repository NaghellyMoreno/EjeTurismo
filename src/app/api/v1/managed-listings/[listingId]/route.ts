import { defaultDeps } from "@/server/http/deps";
import { getManagedListingHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getManagedListingHandler(defaultDeps);
