// pnpm purge:dry-run  -> informa cuántas filas borraría la eliminación del 31 de enero de 2027 (D-043), sin borrar nada.
// pnpm purge:run      -> SOLO DESARROLLO: fija el plazo en hoy y ejecuta la eliminación contra la base local de pruebas.
// Usan la conexión del propietario (DATABASE_MIGRATIONS_URL, o LOCAL_DATABASE_MIGRATIONS_URL en local), porque `eje_app`
// no puede leer `retention_settings`. Nunca imprimen datos personales: solo nombres de tabla y cantidades.
// Node ejecuta este archivo directamente (sin alias de rutas); por eso solo importa pg y módulos de Node.
import pg from "pg";

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const mode = process.argv[2];
if (mode !== "--dry-run" && mode !== "--run") fail("use --dry-run o --run.");
if (mode === "--run" && process.env.NODE_ENV === "production") fail("purge:run es solo de desarrollo y se niega con NODE_ENV=production.");

const connectionString = process.env.DATABASE_MIGRATIONS_URL ?? process.env.LOCAL_DATABASE_MIGRATIONS_URL;
if (!connectionString) fail("falta DATABASE_MIGRATIONS_URL (conexión del propietario).");
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString) || /^[a-z]+:\/\/(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
if (mode === "--run" && !local) fail("purge:run solo actúa sobre una base local.");

// Tablas que se borran completas y, de las fichas, solo las de prestador (los atractivos y sus subidas se conservan, D-198).
const WHOLE_TABLES = [
  "accounts", "bot_sessions", "rate_limit_counters", "role_grants", "consent_events", "provider_registrations",
  "information_requests", "information_request_replies", "information_request_status_events", "audit_events",
  "listing_status_events", "notification_outbox", "processed_updates", "businesses",
];
const PROVIDER_COUNTS: Record<string, string> = {
  listings: "select count(*) from app.listings where kind <> 'attraction'",
  listing_versions: "select count(*) from app.listing_versions v join app.listings l on l.id = v.listing_id where l.kind <> 'attraction'",
  listing_photos: "select count(*) from app.listing_photos p join app.listing_versions v on v.id = p.version_id join app.listings l on l.id = v.listing_id where l.kind <> 'attraction'",
  photo_uploads: "select count(*) from app.photo_uploads p join app.listing_versions v on v.id = p.version_id join app.listings l on l.id = v.listing_id where l.kind <> 'attraction'",
};

const client = new pg.Client({ connectionString, ssl: local ? false : true });
await client.connect();
try {
  if (mode === "--dry-run") {
    const rows: [string, number][] = [];
    for (const table of WHOLE_TABLES) rows.push([table, Number((await client.query(`select count(*) from app.${table}`)).rows[0].count)]);
    for (const [table, query] of Object.entries(PROVIDER_COUNTS)) rows.push([table, Number((await client.query(query)).rows[0].count)]);
    const settings = (await client.query("select deadline::text as deadline, executed_at is not null as executed from app.retention_settings")).rows[0];
    console.log("Filas que se borrarían (simulación, no se cambia nada):");
    for (const [table, count] of rows) console.log(`  ${table}: ${count}`);
    console.log(`Total: ${rows.reduce((sum, [, count]) => sum + count, 0)}`);
    console.log(`Plazo: ${settings.deadline}; ya ejecutada: ${settings.executed ? "sí" : "no"}`);
  } else {
    await client.query("begin");
    await client.query("update app.retention_settings set deadline = (now() at time zone 'America/Bogota')::date where executed_at is null");
    const outcome = (await client.query("select app.purge_personal_data_at(now()) as result")).rows[0].result as { executed: boolean; skippedReason: string | null; deleted: Record<string, number> };
    await client.query("commit");
    if (!outcome.executed) console.log(`No se ejecutó: ${outcome.skippedReason}`);
    else {
      console.log("Eliminación ejecutada. Filas borradas:");
      for (const [table, count] of Object.entries(outcome.deleted)) console.log(`  ${table}: ${count}`);
      console.log(`Total: ${Object.values(outcome.deleted).reduce((sum, count) => sum + Number(count), 0)}`);
    }
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  fail(`no se pudo completar (${(error as { code?: string }).code ?? "error"}); no se cambió nada.`);
} finally {
  await client.end();
}
