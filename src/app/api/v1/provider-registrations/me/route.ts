import { defaultDeps } from "@/server/http/deps";
import { getMyProviderRegistrationHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getMyProviderRegistrationHandler(defaultDeps);
