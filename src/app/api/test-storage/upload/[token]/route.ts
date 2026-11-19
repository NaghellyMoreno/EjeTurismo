import { optionsTestUpload, putTestUpload } from "@/server/http/test-storage";

export const dynamic = "force-dynamic";
// Solo pruebas: 404 salvo con STORAGE_DRIVER=memory fuera de producción (F020, criterios 39 y 41).
export const PUT = putTestUpload;
export const OPTIONS = optionsTestUpload;
