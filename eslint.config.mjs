import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const forbid = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns: patterns.map((group) => ({ group: [group.path], message: group.message })) }],
});

// Fronteras de ADR 0013: el bot y las rutas llaman a servicios, nunca a la base ni al almacenamiento; la Mini App no importa nada del servidor.
const dbAndStorage = [
  { path: "**/server/db", message: "src/app y src/bot usan los servicios; no importan la base (ADR 0001, 0013)." },
  { path: "**/server/db/**", message: "src/app y src/bot usan los servicios; no importan la base (ADR 0001, 0013)." },
  { path: "**/server/storage", message: "src/app y src/bot usan los servicios; no importan el almacenamiento (ADR 0001, 0013)." },
  { path: "**/server/storage/**", message: "src/app y src/bot usan los servicios; no importan el almacenamiento (ADR 0001, 0013)." },
];

const config = [
  ...nextVitals,
  ...nextTs,
  { files: ["src/app/**/*.{ts,tsx}", "src/bot/**/*.ts"], rules: forbid(...dbAndStorage) },
  {
    files: ["src/miniapp/**/*.{ts,tsx}"],
    rules: forbid({ path: "**/server/**", message: "La Mini App no importa código del servidor (ADR 0013)." }),
  },
  { ignores: [".next/**", "node_modules/**", "src/shared/api/schema.d.ts", "next-env.d.ts"] },
];

export default config;
