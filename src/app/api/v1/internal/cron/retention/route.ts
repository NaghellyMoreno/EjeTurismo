import { defaultDeps } from "@/server/http/deps";
import { runRetentionJobHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = runRetentionJobHandler(defaultDeps);
