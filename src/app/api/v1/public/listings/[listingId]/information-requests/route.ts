import { defaultDeps } from "@/server/http/deps";
import { createInformationRequestHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = createInformationRequestHandler(defaultDeps);
