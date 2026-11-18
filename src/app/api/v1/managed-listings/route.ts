import { defaultDeps } from "@/server/http/deps";
import { createListingHandler, listManagedListingsHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listManagedListingsHandler(defaultDeps);
export const POST = createListingHandler(defaultDeps);
