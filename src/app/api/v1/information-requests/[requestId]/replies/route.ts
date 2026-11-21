import { defaultDeps } from "@/server/http/deps";
import { replyToInformationRequestHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = replyToInformationRequestHandler(defaultDeps);
