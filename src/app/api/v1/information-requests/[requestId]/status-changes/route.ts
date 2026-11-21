import { defaultDeps } from "@/server/http/deps";
import { changeInformationRequestStatusHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = changeInformationRequestStatusHandler(defaultDeps);
