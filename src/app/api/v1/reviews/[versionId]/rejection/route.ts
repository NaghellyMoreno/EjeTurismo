import { defaultDeps } from "@/server/http/deps";
import { rejectListingVersionHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = rejectListingVersionHandler(defaultDeps);
