import { defaultDeps } from "@/server/http/deps";
import { createProviderRegistrationHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = createProviderRegistrationHandler(defaultDeps);
