import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// unit: sin base de datos. integration y bot: contra PostgreSQL local, con una base temporal por ejecución (ADR 0014).
const dbProject = (name: string) => ({
  extends: true as const,
  test: {
    name,
    include: [`tests/${name}/**/*.test.ts`],
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/db-env.ts"],
    // Comparten una sola base por proyecto: los archivos corren uno tras otro.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    // F020: las pruebas usan el doble en memoria del almacén de fotos (nunca Vercel Blob).
    env: { STORAGE_DRIVER: "memory" },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      dbProject("integration"),
      dbProject("bot"),
    ],
  },
});
