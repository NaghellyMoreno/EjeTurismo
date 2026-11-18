import { defaultDeps } from "@/server/http/deps";
import { createListingHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = createListingHandler(defaultDeps);
