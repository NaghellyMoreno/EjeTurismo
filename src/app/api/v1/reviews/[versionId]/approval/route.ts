import { defaultDeps } from "@/server/http/deps";
import { approveListingVersionHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = approveListingVersionHandler(defaultDeps);
