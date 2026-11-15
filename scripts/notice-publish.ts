// pnpm notice:publish -- --version 2026-12-v1 --body aviso.md --declaration declaracion.md [--revocation-note frase.md]
// Publica una versión nueva del aviso de privacidad (ADR 0005, D-025): la nueva queda vigente y la anterior pasa a no
// vigente, sin borrarla ni borrar sus pruebas de aceptación. Es una operación de la responsable, no de la interfaz.
// Usa DATABASE_MIGRATIONS_URL (rol propietario). Para local: DATABASE_MIGRATIONS_URL=$LOCAL_DATABASE_MIGRATIONS_URL.
// Node ejecuta este archivo directamente (sin alias de rutas); por eso solo importa pg y módulos de Node.
import { readFileSync } from "node:fs";
import pg from "pg";

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i];
  if (!key?.startsWith("--") || argv[i + 1] === undefined) fail(`argumento no válido: ${key ?? ""}`);
  args.set(key.slice(2), argv[i + 1]);
}

const version = args.get("version");
if (!version || !/^\d{4}-\d{2}-v\d+$/.test(version)) fail("--version es obligatoria y tiene la forma AAAA-MM-vN (por ejemplo, 2026-12-v1).");
const bodyFile = args.get("body");
const declarationFile = args.get("declaration");
if (!bodyFile || !declarationFile) fail("--body y --declaration son obligatorias (rutas a archivos de texto).");
const connectionString = process.env.DATABASE_MIGRATIONS_URL;
if (!connectionString) fail("falta DATABASE_MIGRATIONS_URL.");

const body = readFileSync(bodyFile, "utf8").trim();
const declaration = readFileSync(declarationFile, "utf8").trim();
const revocationNote = args.get("revocation-note") ? readFileSync(args.get("revocation-note")!, "utf8").trim() : null;
if (!body || !declaration) fail("el cuerpo y la declaración no pueden estar vacíos.");

const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString) || /^[a-z]+:\/\/(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
const client = new pg.Client({ connectionString, ssl: local ? false : true });
await client.connect();
try {
  await client.query("begin");
  await client.query("update app.privacy_notice_versions set is_current = false where is_current");
  await client.query(
    "insert into app.privacy_notice_versions (version, body_markdown, declaration_text, revocation_note, published_at, is_current) values ($1, $2, $3, $4, now(), true)",
    [version, body, declaration, revocationNote],
  );
  await client.query("commit");
  console.log(`Versión ${version} publicada y vigente. Las cuentas con una versión anterior verán el aviso nuevo.`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  const code = (error as { code?: string }).code;
  fail(code === "23505" ? `la versión ${version} ya existe.` : "no se pudo publicar la versión (se deshizo todo).");
} finally {
  await client.end();
}
