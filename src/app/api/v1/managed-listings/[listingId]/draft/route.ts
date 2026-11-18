import { defaultDeps } from "@/server/http/deps";
import { saveListingDraftHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const PUT = saveListingDraftHandler(defaultDeps);
