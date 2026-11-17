import { Kysely, PostgresDialect, WithSchemaPlugin } from "kysely";
import { Pool, type PoolConfig } from "pg";
import type { Database } from "./types";

export type { Database } from "./types";

let db: Kysely<Database> | undefined;

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;

// SSL de la conexión (ADR 0012 y 0014). En local, sin SSL. En la nube, SSL que verifica el servidor contra el
// certificado raíz de Supabase (DATABASE_CA_CERT), que no está entre las autoridades de Node. Falla cerrado: sin
// certificado válido no se conecta, y no se acepta `sslmode` en la URL porque `pg` lo aplica por encima de `ssl`.
// Nunca repite los valores.
export function poolSsl(connectionString: string, caCert: string | undefined): PoolConfig["ssl"] {
  const local = connectionString.includes("127.0.0.1") || connectionString.includes("localhost");
  if (local) return false;
  if (/[?&]sslmode=/i.test(connectionString)) {
    throw new Error("DATABASE_URL no debe incluir sslmode; el SSL lo configura la aplicación con DATABASE_CA_CERT.");
  }
  // Admite el PEM con saltos de línea reales o escritos como \n (una sola línea en .env).
  const ca = caCert?.replace(/\\n/g, "\n").trim();
  if (!ca || !PEM_CERTIFICATE.test(ca)) {
    throw new Error("Falta DATABASE_CA_CERT o no es un certificado PEM válido.");
  }
  return { ca, rejectUnauthorized: true };
}

// Todas las tablas viven en el esquema `app` (ADR 0006).
export function createDb(connectionString: string, caCert?: string): Kysely<Database> {
  const ssl = poolSsl(connectionString, caCert);
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 1, ssl }) }),
    plugins: [new WithSchemaPlugin("app")],
  });
}

// Un cliente por instancia, grupo de tamaño 1, SSL obligatorio y verificado (ADR 0012).
export function getDb(): Kysely<Database> {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta DATABASE_URL");
    db = createDb(connectionString, process.env.DATABASE_CA_CERT);
  }
  return db;
}
