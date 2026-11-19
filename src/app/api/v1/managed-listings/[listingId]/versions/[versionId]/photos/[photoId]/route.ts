import { defaultDeps } from "@/server/http/deps";
import { removePhotoHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const DELETE = removePhotoHandler(defaultDeps);
