import type { Client } from "pg";

// Borra una base temporal sin `with (force)`: `postgres` no es superusuario y ese modo falla con
// "permission denied to terminate process". Cierra las sesiones de cliente con pg_terminate_backend y reintenta,
// porque el servidor de pruebas puede reconectar entre un paso y otro. Lo comparten las pruebas de integración y las e2e.
export async function dropDatabase(admin: Client, dbName: string, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and backend_type = 'client backend' and pid <> pg_backend_pid()",
      [dbName],
    );
    try {
      await admin.query(`drop database if exists "${dbName}"`);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
