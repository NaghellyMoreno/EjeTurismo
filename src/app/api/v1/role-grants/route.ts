import { defaultDeps } from "@/server/http/deps";
import { authorizeAdministratorHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = authorizeAdministratorHandler(defaultDeps);
