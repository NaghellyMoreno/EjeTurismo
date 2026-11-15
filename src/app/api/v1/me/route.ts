import { defaultDeps } from "@/server/http/deps";
import { getMeHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getMeHandler(defaultDeps);
