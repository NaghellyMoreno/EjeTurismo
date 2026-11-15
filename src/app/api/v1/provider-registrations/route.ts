import { defaultDeps } from "@/server/http/deps";
import { createProviderRegistrationHandler, listProviderRegistrationsHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = createProviderRegistrationHandler(defaultDeps);
export const GET = listProviderRegistrationsHandler(defaultDeps);
