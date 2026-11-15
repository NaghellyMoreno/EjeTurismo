import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  WithSchemaPlugin,
  type DatabaseConnection,
  type Driver,
} from "kysely";
import type { Database } from "@/server/db/types";

// Cliente de base simulado: registra cada consulta y falla con un texto reconocible. Sirve para comprobar que algo NO
// consulta la base (queries.length === 0) y que los errores de la base no se filtran en las respuestas.
export function failingDb(errorText = "fallo-interno-secreto") {
  const queries: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery(query) {
      queries.push(query.sql);
      throw new Error(errorText);
    },
    async *streamQuery() {
      throw new Error(errorText);
    },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new WithSchemaPlugin("app")],
  });
  return { db, queries, errorText };
}
