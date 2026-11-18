import { defaultDeps } from "@/server/http/deps";
import { submitListingForReviewHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = submitListingForReviewHandler(defaultDeps);
