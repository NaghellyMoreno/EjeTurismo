import { defaultDeps } from "@/server/http/deps";
import { listPendingReviewsHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = listPendingReviewsHandler(defaultDeps);
