import { defaultDeps } from "@/server/http/deps";
import { authorizeAdministratorHandler, listRoleGrantsHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listRoleGrantsHandler(defaultDeps);
export const POST = authorizeAdministratorHandler(defaultDeps);
