import { defaultDeps } from "@/server/http/deps";
import { registerPhotoHandler } from "@/server/http/handlers";

export const dynamic = "force-dynamic";
export const POST = registerPhotoHandler(defaultDeps);
