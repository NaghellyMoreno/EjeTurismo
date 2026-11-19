import { defaultDeps } from "@/server/http/deps";
import { getPublishedListingHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getPublishedListingHandler(defaultDeps);
