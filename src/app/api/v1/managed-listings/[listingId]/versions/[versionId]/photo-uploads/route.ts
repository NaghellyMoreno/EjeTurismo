import { defaultDeps } from "@/server/http/deps";
import { createPhotoUploadHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = createPhotoUploadHandler(defaultDeps);
