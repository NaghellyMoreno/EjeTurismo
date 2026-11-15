import { defaultDeps } from "@/server/http/deps";
import { rejectProviderRegistrationHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = rejectProviderRegistrationHandler(defaultDeps);
