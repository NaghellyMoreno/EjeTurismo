import { defaultDeps } from "@/server/http/deps";
import { listPublishedListingsHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listPublishedListingsHandler(defaultDeps);
