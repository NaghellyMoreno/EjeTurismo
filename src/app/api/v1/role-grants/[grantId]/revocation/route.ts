import { defaultDeps } from "@/server/http/deps";
import { revokeRoleHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = revokeRoleHandler(defaultDeps);
