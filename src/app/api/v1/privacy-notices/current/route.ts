import { defaultDeps } from "@/server/http/deps";
import { getCurrentPrivacyNoticeHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getCurrentPrivacyNoticeHandler(defaultDeps);
