import { defaultDeps } from "@/server/http/deps";
import { runMaintenanceJobHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = runMaintenanceJobHandler(defaultDeps);
