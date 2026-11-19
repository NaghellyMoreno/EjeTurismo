import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Pool } from "pg";
import { memoryStorage } from "@/server/storage";
import { createAccount, createOldVersionAccount, grantAdmin } from "../factories/accounts";
import { createRegistration, makeProvider } from "../factories/review";
import { seedListing } from "./listing-data";
import { jpegBytes } from "./photo-data";
import { PROTECTED_OPERATIONS, specOperations, UNKNOWN_ID, type ProtectedOperation } from "./protected-operations";

// Matriz de F007: acceso denegado por rol (visitante y registro pendiente). Las funcionalidades siguientes (F012 en adelante)
// pasan `hasRoute` a true al crear la ruta de cada operación y agregan su caso en ROLE_CASES (D-136, D-137).
export type PersonKey = "A1" | "A2" | "A3" | "A4" | "A5";
export const PERSON_KEYS: PersonKey[] = ["A1", "A2", "A3", "A4", "A5"];

// Datos ficticios (rango 900007001 en adelante).
export const ADMIN_TEST = 900007001; // administrador de prueba, con permiso `admin` en role_grants
export const ADMIN_OTHER = 900007002; // segundo administrador; su permiso se revoca en el control positivo
export const PERSON_IDS: Record<PersonKey, number> = { A1: 900007011, A2: 900007012, A3: 900007013, A4: 900007014, A5: 900007015 };
export const PENDING_OWNER = 900007021; // registro `pending` "Registro Ficticio Secreto"
export const PENDING_OTHER = 900007022; // segundo registro `pending` para el control positivo
export const PROVIDER_CONTROL = 900007031; // prestador activo de las rutas de muestra
export const NEW_ADMIN_ID = "900007041"; // ID ficticio que se autoriza
export const SECRET_REGISTRATION_NAME = "Registro Ficticio Secreto";
export const SECRET_MUNICIPALITY_NAME = "Municipio Ficticio Secreto";
export const SECRET_IDENTITY_NUMBER = "9000070210";
export const VALID_REASON = "Documento ilegible";

export interface Denial {
  status: 403;
  code: "consent_required" | "forbidden";
}
// D-108 y D-039: sin cuenta o con aviso anterior, 403 `consent_required`; con aviso vigente y sin rol, 403 `forbidden`.
export const EXPECTED_DENIAL: Record<PersonKey, Denial> = {
  A1: { status: 403, code: "consent_required" },
  A2: { status: 403, code: "forbidden" },
  A3: { status: 403, code: "consent_required" },
  A4: { status: 403, code: "forbidden" },
  A5: { status: 403, code: "forbidden" },
};

export interface RoleDenialOperation {
  operationId: string;
  roles: ("admin" | "provider")[];
  hasRoute: boolean;
  deniedPersons: Record<PersonKey, Denial>;
}

const entry = (operationId: string, roles: ("admin" | "provider")[], hasRoute: boolean): RoleDenialOperation => ({
  operationId,
  roles,
  hasRoute,
  deniedPersons: { ...EXPECTED_DENIAL },
});

// Las 14 operaciones de administrador con ruta (criterio 1 de F007; las ejecuta la matriz).
export const ADMIN_OPERATION_IDS = [
  "listProviderRegistrations", "approveProviderRegistration", "rejectProviderRegistration", "listRoleGrants", "authorizeAdministrator",
  "revokeRole", "createMunicipality", "updateMunicipality", "createCategory", "updateCategory", "createExperienceType",
  "updateExperienceType", "createEstablishmentType", "updateEstablishmentType",
];

// Las 4 operaciones de revisión de F014 (solo administrador).
export const REVIEW_OPERATION_IDS = ["listPendingReviews", "getReview", "approveListingVersion", "rejectListingVersion"];

// F029: el historial de estados de una ficha (solo administrador).
export const HISTORY_OPERATION_ID = "getListingStatusHistory";

// F020: las 3 operaciones de fotos (prestador y administrador).
export const PHOTO_OPERATION_IDS = ["createPhotoUpload", "registerPhoto", "removePhoto"];

// Operaciones de rol con ruta: las 14 de solo administrador, `createListing` (F012), las 4 de F013, las 4 de F014, la de F029 y las 3 de F020 (D-136 y D-137).
// `ADMIN_OPERATION_IDS` no cambia: F008 y la autorrevocación la usan.
export const ROUTED_OPERATION_IDS = [
  ...ADMIN_OPERATION_IDS, "createListing", "listManagedListings", "getManagedListing", "saveListingDraft", "submitListingForReview", ...REVIEW_OPERATION_IDS, HISTORY_OPERATION_ID, ...PHOTO_OPERATION_IDS,
];

// Las 4 operaciones de rol sin `route.ts` todavía (criterio 15 de F007; cobertura diferida a las funcionalidades siguientes).
export const UNROUTED_OPERATION_IDS = [
  "listMyBusinessInformationRequests", "getInformationRequest", "replyToInformationRequest", "changeInformationRequestStatus",
];

export const ROLE_DENIAL_OPERATIONS: RoleDenialOperation[] = [
  ...ADMIN_OPERATION_IDS.map((id) => entry(id, ["admin"], true)),
  entry("createListing", ["provider", "admin"], true),
  ...["listManagedListings", "getManagedListing", "saveListingDraft", "submitListingForReview", ...REVIEW_OPERATION_IDS, HISTORY_OPERATION_ID, ...PHOTO_OPERATION_IDS].map((id) => entry(id, specRoles(id), true)),
  ...UNROUTED_OPERATION_IDS.map((id) => entry(id, specRoles(id), false)),
];

function specRoles(operationId: string): ("admin" | "provider")[] {
  const roles = specOperations.find((o) => o.operationId === operationId)?.roles ?? [];
  return roles.filter((r): r is "admin" | "provider" => r === "admin" || r === "provider");
}

// ---- Rutas existentes según el sistema de archivos ---------------------------------------------------------------
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

// operationId de las operaciones del openapi que tienen `route.ts` con el método exportado.
export function operationIdsWithRoute(): Set<string> {
  const root = join(process.cwd(), "src/app/api");
  const keys = new Set(
    walk(join(root, "v1"))
      .filter((f) => f.endsWith(`${sep}route.ts`))
      .flatMap((file) => {
        const path = "/api/" + relative(root, file).split(sep).slice(0, -1).join("/").replace(/\[(\w+)\]/g, "{$1}");
        return [...readFileSync(file, "utf8").matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => `${m[1]} ${path}`);
      }),
  );
  return new Set(specOperations.filter((o) => keys.has(`${o.method} ${o.path}`)).map((o) => o.operationId));
}

// Operaciones con `x-roles` que incluye `admin` o `provider`.
export const roleOperations = () => specOperations.filter((o) => o.roles.some((r) => r === "admin" || r === "provider"));

// ---- Casos de la matriz HTTP -------------------------------------------------------------------------------------
export type ResourceKey =
  | "registrationId" | "secondRegistrationId" | "grantId" | "municipalityId" | "categoryId" | "experienceTypeId" | "establishmentTypeId"
  | "draftListingId" | "submitListingId" | "pendingListingId" | "reviewVersionId" | "approveVersionId" | "rejectVersionId"
  | "draftVersionId" | "photoId" | "uploadId";

export interface RoleCase {
  operationId: string;
  resource?: ResourceKey; // el ID real que reemplaza al de la ruta
  resources?: ResourceKey[]; // F020: rutas con varios IDs (ficha, versión y foto), en el orden de la ruta
  query?: string; // consulta de la petición válida (por ejemplo `confirmed=true`)
  body?: Record<string, unknown>; // cuerpo válido (columna "Cuerpo" del criterio 10); sin él, la operación no lleva cuerpo
  bodyFor?: (fixtures: RoleFixtures) => Record<string, unknown>; // cuerpo válido que usa datos reales de `seedRoleDenial`
  positive: number; // código exacto del control positivo
  positiveActor?: number; // quien obtiene el control positivo (F013): por defecto, el administrador de prueba
  kind?: "attraction" | "establishment"; // segundo caso de `createListing` (F013, P8)
}

// En el orden del control positivo del criterio 10 de F007.
export const ROLE_CASES: RoleCase[] = [
  { operationId: "listProviderRegistrations", positive: 200 },
  { operationId: "listRoleGrants", positive: 200 },
  { operationId: "createMunicipality", body: { name: "Municipio Control Uno", department: "Caldas", confirmed: true }, positive: 201 },
  { operationId: "createCategory", body: { name: "Categoria Control Uno", confirmed: true }, positive: 201 },
  { operationId: "createExperienceType", body: { name: "Experiencia Control Uno", confirmed: true }, positive: 201 },
  { operationId: "createEstablishmentType", body: { name: "Establecimiento Control Uno", confirmed: true }, positive: 201 },
  { operationId: "updateMunicipality", resource: "municipalityId", body: { name: "Municipio Control Dos", confirmed: true }, positive: 200 },
  { operationId: "updateCategory", resource: "categoryId", body: { name: "Categoria Control Dos", confirmed: true }, positive: 200 },
  { operationId: "updateExperienceType", resource: "experienceTypeId", body: { name: "Experiencia Control Dos", confirmed: true }, positive: 200 },
  { operationId: "updateEstablishmentType", resource: "establishmentTypeId", body: { name: "Establecimiento Control Dos", confirmed: true }, positive: 200 },
  { operationId: "authorizeAdministrator", body: { telegramUserId: NEW_ADMIN_ID, confirmed: true }, positive: 201 },
  { operationId: "approveProviderRegistration", resource: "registrationId", body: { confirmed: true }, positive: 200 },
  { operationId: "rejectProviderRegistration", resource: "secondRegistrationId", body: { confirmed: true, reason: VALID_REASON }, positive: 200 },
  { operationId: "revokeRole", resource: "grantId", body: { confirmed: true }, positive: 200 },
  // F012 (D-137): atractivo con el municipio y la categoría reales de `seedRoleDenial`.
  {
    operationId: "createListing",
    bodyFor: (fixtures) => ({
      kind: "attraction",
      content: {
        name: "Atractivo Ficticio Uno",
        municipalityId: fixtures.ids.municipalityId,
        categoryId: fixtures.ids.categoryId,
        description: "Descripción ficticia.",
        schedule: "Todos los días de 8:00 a 17:00",
        contact: "contacto@ejemplo.invalid",
        mapsUrl: "https://maps.app.goo.gl/AbCdEf123",
      },
      confirmed: true,
    }),
    positive: 201,
  },
  // F013 (D-136, D-137, P8): establecimiento del prestador y las 4 operaciones nuevas.
  {
    operationId: "createListing",
    kind: "establishment",
    bodyFor: (fixtures) => ({
      kind: "establishment",
      content: {
        name: "Establecimiento Ficticio Uno",
        municipalityId: fixtures.ids.municipalityId,
        categoryId: fixtures.ids.categoryId,
        establishmentTypeId: fixtures.ids.establishmentTypeId,
        description: "Descripción ficticia.",
        schedule: "Todos los días de 8:00 a 17:00",
        contact: "contacto@ejemplo.invalid",
        mapsUrl: "https://maps.app.goo.gl/AbCdEf123",
      },
      confirmed: true,
    }),
    positive: 201,
    positiveActor: PROVIDER_CONTROL,
  },
  { operationId: "listManagedListings", positive: 200 },
  { operationId: "getManagedListing", resource: "pendingListingId", positive: 200 },
  {
    operationId: "saveListingDraft",
    resource: "draftListingId",
    bodyFor: (fixtures) => ({ content: { name: "Ficha Sembrada Borrador Editada", municipalityId: fixtures.ids.municipalityId }, confirmed: true }),
    positive: 200,
    positiveActor: PROVIDER_CONTROL,
  },
  {
    operationId: "submitListingForReview",
    resource: "submitListingId",
    body: { confirmed: true, thirdPartyAuthorizationDeclared: true },
    positive: 200,
    positiveActor: PROVIDER_CONTROL,
  },
  // F014 (D-136, D-137): las 4 operaciones de revisión; cada decisión usa su propia versión pendiente sembrada.
  { operationId: "listPendingReviews", positive: 200 },
  { operationId: "getReview", resource: "reviewVersionId", positive: 200 },
  { operationId: "approveListingVersion", resource: "approveVersionId", body: { confirmed: true }, positive: 200 },
  { operationId: "rejectListingVersion", resource: "rejectVersionId", body: { confirmed: true, reason: "Motivo ficticio." }, positive: 200 },
  // F029 (D-136, D-137): historial de estados de una ficha (la pendiente sembrada).
  { operationId: "getListingStatusHistory", resource: "pendingListingId", positive: 200 },
  // F020 (D-136, D-137): las 3 operaciones de fotos sobre el borrador sembrado de A6 (la foto y la subida sembradas son suyas).
  {
    operationId: "createPhotoUpload",
    resources: ["draftListingId", "draftVersionId"],
    body: { fileName: "foto-ficticia.jpg", contentType: "image/jpeg", sizeBytes: 1000 },
    positive: 201,
    positiveActor: PROVIDER_CONTROL,
  },
  {
    operationId: "registerPhoto",
    resources: ["draftListingId", "draftVersionId"],
    bodyFor: (fixtures) => ({ uploadId: fixtures.ids.uploadId }),
    positive: 201,
    positiveActor: PROVIDER_CONTROL,
  },
  {
    operationId: "removePhoto",
    resources: ["draftListingId", "draftVersionId", "photoId"],
    query: "confirmed=true",
    positive: 204,
    positiveActor: PROVIDER_CONTROL,
  },
];

// `roleCaseOf("createListing")` devuelve el de atractivo; el de establecimiento se pide con `kind`.
export const roleCaseOf = (operationId: string, kind?: RoleCase["kind"]): RoleCase => {
  const found = ROLE_CASES.find((c) => c.operationId === operationId && (kind === undefined || c.kind === kind));
  if (!found) throw new Error(`Falta el caso de ROLE_CASES para ${operationId}: toda operación con ruta entra a la matriz (D-136)`);
  return found;
};

export const operationOf = (operationId: string): ProtectedOperation => {
  const found = PROTECTED_OPERATIONS.find((o) => o.operationId === operationId);
  if (!found) throw new Error(`Falta ${operationId} en PROTECTED_OPERATIONS`);
  return found;
};

// ---- Datos de prueba ---------------------------------------------------------------------------------------------
export interface RoleFixtures {
  ids: Record<ResourceKey, string>;
  a4RegistrationId: string;
  providerControlAccountId: string;
}

export async function seedRoleDenial(owner: Pool): Promise<RoleFixtures> {
  await createAccount(owner, ADMIN_TEST, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN_TEST);
  await createAccount(owner, ADMIN_OTHER, "Administrador Ficticio Dos");
  await grantAdmin(owner, ADMIN_OTHER);
  // A1: sin cuenta. A2: aviso vigente. A3: aviso anterior. A4: registro pendiente. A5: registro rechazado.
  await createAccount(owner, PERSON_IDS.A2, "Visitante Ficticio");
  await createOldVersionAccount(owner, PERSON_IDS.A3);
  const a4 = await createAccount(owner, PERSON_IDS.A4, "Pendiente Ficticio");
  const a4RegistrationId = await createRegistration(owner, a4, { status: "pending", number: "9000070140" });
  const a5 = await createAccount(owner, PERSON_IDS.A5, "Rechazada Ficticia");
  await createRegistration(owner, a5, { status: "rejected", number: "9000070150" });
  const secretAccount = await createAccount(owner, PENDING_OWNER, SECRET_REGISTRATION_NAME);
  const registrationId = await createRegistration(owner, secretAccount, { status: "pending", number: SECRET_IDENTITY_NUMBER });
  const otherAccount = await createAccount(owner, PENDING_OTHER, "Otra Persona Ficticia");
  const secondRegistrationId = await createRegistration(owner, otherAccount, { status: "pending", number: "9000070220" });
  // Registro `approved` con el número cifrado de verdad (el listado de administrador lo descifra) y permiso `provider`.
  const providerControlAccountId = await makeProvider(owner, PROVIDER_CONTROL, "9000070310");

  const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0].id as string;
  const grantId = await one("select id from app.role_grants where telegram_user_id = $1 and role = 'admin'", [ADMIN_OTHER]);
  const municipalityId = await one(
    "insert into app.municipalities (name, name_normalized, department) values ($1, 'municipio ficticio secreto', 'Caldas') returning id",
    [SECRET_MUNICIPALITY_NAME],
  );
  const categoryId = await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia', 'categoria ficticia') returning id");
  const experienceTypeId = await one("insert into app.experience_types (name, name_normalized) values ('Experiencia Ficticia', 'experiencia ficticia') returning id");
  const establishmentTypeId = await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id");
  // F013: tres fichas de A6 para los controles positivos (un borrador, un borrador completo y una pendiente).
  const own = { accountId: providerControlAccountId, municipalityId, categoryId };
  const draftListingId = (await seedListing(owner, { ...own, name: "Ficha Sembrada Borrador" })).listingId;
  const submitListingId = (await seedListing(owner, { ...own, name: "Ficha Sembrada Completa", complete: true })).listingId;
  const pending = await seedListing(owner, { ...own, name: "Ficha Sembrada Pendiente", status: "pending" });
  const pendingListingId = pending.listingId;
  // F014: tres versiones pendientes de A6 para los controles positivos de las operaciones de revisión.
  const reviewVersionId = pending.versionId;
  const approveVersionId = (await seedListing(owner, { ...own, name: "Ficha Sembrada Revisión Uno", status: "pending" })).versionId;
  const rejectVersionId = (await seedListing(owner, { ...own, name: "Ficha Sembrada Revisión Dos", status: "pending" })).versionId;
  // F020: una foto y una subida emitida (con su archivo en el doble) sobre la versión borrador sembrada, para los controles positivos.
  const draftVersionId = await one("select id from app.listing_versions where listing_id = $1", [draftListingId]);
  const photoId = await one(
    "insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position, uploaded_by) values ($1, $2, 'image/jpeg', 1000, 1, $3) returning id",
    [draftVersionId, `listings/${draftListingId}/sembrada.jpg`, providerControlAccountId],
  );
  const uploadId = randomUUID();
  const uploadPathname = `listings/${draftListingId}/${uploadId}.jpg`;
  await owner.query(
    "insert into app.photo_uploads (id, version_id, requested_by_account_id, pathname, declared_size, content_type, expires_at) values ($1, $2, $3, $4, 1000, 'image/jpeg', now() + interval '1 hour')",
    [uploadId, draftVersionId, providerControlAccountId, uploadPathname],
  );
  memoryStorage().put(uploadPathname, jpegBytes(1000), "image/jpeg");
  return {
    ids: {
      registrationId, secondRegistrationId, grantId, municipalityId, categoryId, experienceTypeId, establishmentTypeId, draftListingId, submitListingId,
      pendingListingId, reviewVersionId, approveVersionId, rejectVersionId, draftVersionId, photoId, uploadId,
    },
    a4RegistrationId,
    providerControlAccountId,
  };
}

// ---- Peticiones --------------------------------------------------------------------------------------------------
export function roleRequest(fixtures: RoleFixtures, rc: RoleCase, headers: Record<string, string>, variant: "valid" | "empty" = "valid"): Request {
  const op = operationOf(rc.operationId);
  const keys = rc.resources ?? [rc.resource];
  let placeholder = 0;
  const path = op.path.replace(new RegExp(UNKNOWN_ID, "g"), () => {
    const key = keys[placeholder++];
    return key && variant === "valid" ? fixtures.ids[key] : UNKNOWN_ID;
  });
  const url = `http://localhost${path}${rc.query && variant === "valid" ? `?${rc.query}` : ""}`;
  if (!op.hasBody) return new Request(url, { method: op.method, headers });
  const body = variant === "valid" ? (rc.bodyFor ? rc.bodyFor(fixtures) : rc.body) : {};
  return new Request(url, { method: op.method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

// Los manejadores leen su propio parámetro; se entregan todos con el mismo ID.
export const roleContext = (id: string) => ({
  params: Promise.resolve({
    registrationId: id, grantId: id, municipalityId: id, categoryId: id, experienceTypeId: id, establishmentTypeId: id, listingId: id, versionId: id, photoId: id,
  }),
});
export const contextFor = (fixtures: RoleFixtures, rc: RoleCase, variant: "valid" | "empty" = "valid") => {
  if (rc.resources) {
    const [listingId, versionId, photoId] = rc.resources.map((key) => (variant === "valid" ? fixtures.ids[key] : UNKNOWN_ID));
    return { params: Promise.resolve({ listingId: listingId!, versionId: versionId!, photoId: photoId ?? UNKNOWN_ID }) };
  }
  return roleContext(rc.resource && variant === "valid" ? fixtures.ids[rc.resource] : UNKNOWN_ID);
};

// ---- Instantánea -------------------------------------------------------------------------------------------------
export type Snapshot = Record<string, { count: number; md5: string }>;

// Por cada tabla del esquema `app`: conteo de filas y md5 de su contenido ordenado, con el rol propietario.
export async function snapshotAll(owner: Pool): Promise<Snapshot> {
  const tables = (await owner.query("select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE' order by table_name")).rows;
  const out: Snapshot = {};
  for (const { table_name: table } of tables) {
    const { rows } = await owner.query(
      `select count(*)::int as count, md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as md5 from app."${table}" t`,
    );
    out[table] = rows[0];
  }
  return out;
}

// Nombres de las tablas cuyo conteo o contenido difiere.
export const changedTables = (before: Snapshot, after: Snapshot): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t])).sort();
