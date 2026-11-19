import { defaultDeps } from "@/server/http/deps";
import { getListingStatusHistoryHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getListingStatusHistoryHandler(defaultDeps);
