import { defaultDeps } from "@/server/http/deps";
import { getReviewHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const GET = getReviewHandler(defaultDeps);
