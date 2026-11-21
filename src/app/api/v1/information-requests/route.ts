import { defaultDeps } from "@/server/http/deps";
import { listMyBusinessInformationRequestsHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listMyBusinessInformationRequestsHandler(defaultDeps);
