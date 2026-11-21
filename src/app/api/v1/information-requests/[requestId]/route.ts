import { defaultDeps } from "@/server/http/deps";
import { getInformationRequestHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getInformationRequestHandler(defaultDeps);
