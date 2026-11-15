import type { Kysely } from "kysely";
import type { Database } from "@/server/db/types";

// Cliente de base de datos que reciben los servicios. El bot y las rutas lo reciben ya construido y nunca consultan por su cuenta.
export type Db = Kysely<Database>;
