import { defaultDeps } from "@/server/http/deps";
import { acceptPrivacyNoticeHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = acceptPrivacyNoticeHandler(defaultDeps);
