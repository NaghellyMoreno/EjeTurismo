import { defaultDeps } from "@/server/http/deps";
import { revokeMyAuthorizationHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = revokeMyAuthorizationHandler(defaultDeps);
