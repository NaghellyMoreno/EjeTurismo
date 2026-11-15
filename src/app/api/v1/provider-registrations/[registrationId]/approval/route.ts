import { defaultDeps } from "@/server/http/deps";
import { approveProviderRegistrationHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = approveProviderRegistrationHandler(defaultDeps);
