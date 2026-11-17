import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { createRegistration, grantAdminRole, makeProvider, namedAccount, NUMBER_1, pendingFor } from "../factories/review";
import { buttonsOf, createTestBot, noRoleMenu, pendingMenu } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F005: menú por rol sin repetir el registro (criterios 1 a 11, 16 a 19 y 30).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const PROVIDER = 900000061;
const ADMIN = 900000062;
const NO_ROLE = 900000063;
const PENDING = 900000064;
const REJECTED = 900000065;
const BOTH = 900000066;
const OLD_NOTICE = 900000067;
const NO_ACCOUNT = 900000068;
const REGISTER = "provider:register";

let owner: Pool;
const t = createTestBot();
const start = (id: number) => textUpdate("/start", { fromId: id });
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const allButtons = () => t.messages().flatMap((m) => buttonsOf(m.payload));
const noButtons = () => t.messages().every((m) => m.payload.reply_markup === undefined);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  t.clear();
  afterTasks.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("paso 1: el prestador no repite el registro (criterios 1 a 5)", () => {
  it("1 y 2: /start muestra el menú de prestador, sin botones, sin pedir tipo ni número", async () => {
    await makeProvider(owner, PROVIDER);
    const before = await count("provider_registrations");
    await t.send(start(PROVIDER));
    expect(t.texts()).toEqual([es.menu.welcome, es.menu.providerAvailable]);
    expect(noButtons()).toBe(true);
    expect(t.texts()).not.toContain(es.provider.askType);
    expect(t.texts()).not.toContain(es.provider.askNumber);
    expect(await count("bot_sessions")).toBe(0);
    expect(await count("provider_registrations")).toBe(before);
  });

  it("3: tras aprobar el registro, el /start siguiente muestra el menú de prestador", async () => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    const { registrationId } = await pendingFor(owner, PROVIDER, { number: NUMBER_1 });
    await t.send(press(ADMIN, `adm:a:${registrationId}`));
    await t.send(press(ADMIN, `adm:ca:${registrationId}`));
    while (afterTasks.length > 0) await afterTasks.shift()!();
    t.clear();
    await t.send(start(PROVIDER));
    expect(t.texts()).toEqual([es.menu.welcome, es.menu.providerAvailable]);
    expect(noButtons()).toBe(true);
    expect(await count("bot_sessions")).toBe(0);
  });

  it("4: un botón antiguo de registro no abre formulario ni crea filas", async () => {
    await makeProvider(owner, PROVIDER);
    const before = [await count("provider_registrations"), await count("bot_sessions")];
    await t.send(press(PROVIDER, REGISTER));
    expect(t.texts()).toEqual([es.menu.welcome, es.menu.providerAvailable]);
    expect(noButtons()).toBe(true);
    expect([await count("provider_registrations"), await count("bot_sessions")]).toEqual(before);
  });

  it("5: el menú sale del permiso activo en cada actualización", async () => {
    await makeProvider(owner, PROVIDER);
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [PROVIDER]);
    await t.send(start(PROVIDER));
    expect(t.texts()).not.toContain(es.menu.providerAvailable);
    expect(t.texts()).toEqual([noRoleMenu]);
  });
});

describe("paso 2: el administrador ve su menú (criterios 6 a 9)", () => {
  const adminButtons = [es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button];

  it("6: permiso admin, exactamente los tres botones (F006)", async () => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    await t.send(start(ADMIN));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(allButtons()).toEqual(adminButtons);
    expect(t.texts()).not.toContain(es.menu.providerAvailable);
  });

  it.each([
    ["sin fila is_principal", false],
    ["con fila is_principal", true],
  ])("7: el principal %s ve el mismo menú", async (_name, withRow) => {
    await createAccount(owner, PERSON_PRINCIPAL);
    if (withRow) await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PERSON_PRINCIPAL]);
    await t.send(start(PERSON_PRINCIPAL));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(allButtons()).toEqual(adminButtons);
  });

  it("8: autorizado antes de aceptar el aviso, ve primero el aviso y luego el menú", async () => {
    await grantAdminRole(owner, ADMIN);
    await t.send(start(ADMIN));
    expect(t.texts().join("\n")).not.toContain(es.menu.welcome);
    const accept = t.messages().flatMap((m) => ((m.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat())
      .find((b) => b.callback_data?.startsWith("consent:accept:"));
    expect(accept).toBeDefined();
    t.clear();
    await t.send(press(ADMIN, accept!.callback_data!));
    expect(t.texts()).toContain(es.menu.welcome);
    expect(allButtons()).toEqual(adminButtons);
    expect(t.texts()).not.toContain(es.provider.askType);
    expect(t.texts()).not.toContain(es.provider.askNumber);
  });

  it("9: con permisos admin y provider a la vez prevalece el administrador (D-116)", async () => {
    await makeProvider(owner, BOTH);
    await grantAdminRole(owner, BOTH);
    await t.send(start(BOTH));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(allButtons()).toEqual(adminButtons);
  });
});

describe("paso 3: el administrador no se registra como prestador (criterios 10 y 11)", () => {
  it.each([
    ["con permiso", ADMIN],
    ["principal", PERSON_PRINCIPAL],
  ])("10 y 11: %s nunca ve el botón y un callback antiguo no abre el formulario", async (_name, id) => {
    await createAccount(owner, id);
    if (id === ADMIN) await grantAdminRole(owner, id);
    await t.send(start(id));
    await t.send(textUpdate("hola", { fromId: id }));
    await t.send(press(id, REGISTER));
    expect(allButtons()).not.toContain(es.menu.registerButton);
    expect(t.texts()).not.toContain(es.provider.askType);
    expect(await count("bot_sessions")).toBe(0);
    expect(await count("provider_registrations")).toBe(0);
  });
});

describe("paso 4: sin rol solo se ve el registro (criterios 16 a 19)", () => {
  it("16: sin rol y sin registro, exactamente un botón", async () => {
    await createAccount(owner, NO_ROLE);
    await t.send(start(NO_ROLE));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(allButtons()).toEqual([es.menu.registerButton, es.selfRevoke.button]);
  });

  it("17: con registro pendiente, solo provider.pending y ningún botón", async () => {
    await pendingFor(owner, PENDING);
    await t.send(start(PENDING));
    expect(t.texts()).toEqual([pendingMenu]);
    expect(allButtons()).toEqual([es.selfRevoke.button]);
  });

  it("18: con registro rechazado ve el botón y al pulsarlo se abre el formulario (D-115)", async () => {
    await pendingFor(owner, REJECTED, { status: "rejected" });
    await t.send(start(REJECTED));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(allButtons()).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    t.clear();
    await t.send(press(REJECTED, REGISTER));
    expect(t.texts()).toEqual([es.provider.askType]);
  });

  it("19: sin aviso o con aviso anterior solo se muestra el aviso", async () => {
    await createOldVersionAccount(owner, OLD_NOTICE);
    for (const id of [NO_ACCOUNT, OLD_NOTICE]) {
      t.clear();
      await t.send(start(id));
      expect(t.texts()).not.toContain(es.menu.welcome);
      expect(allButtons()).not.toContain(es.menu.registerButton);
    }
  });

  it("19: sin rol, texto suelto y callbacks de administrador reciben admin.forbidden sin cambios", async () => {
    await createAccount(owner, NO_ROLE);
    for (const data of ["adm:list", "auth:start"]) {
      t.clear();
      await t.send(press(NO_ROLE, data));
      expect(t.texts()).toEqual([es.admin.forbidden]);
    }
    t.clear();
    await t.send(textUpdate("Registros pendientes", { fromId: NO_ROLE }));
    expect(allButtons()).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    expect(await count("provider_registrations")).toBe(0);
    expect(await count("role_grants")).toBe(0);
  });
});

describe("criterio 30: errores", () => {
  it("un fallo de la base responde el mensaje común y no deja sesión", async () => {
    await namedAccount(owner, PROVIDER);
    await createRegistration(owner, (await rows("select id from app.accounts"))[0].id, { status: "approved" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = createTestBot({ db: () => failingDb("ECONNREFUSED tabla role_grants").db });
    await broken.send(start(PROVIDER));
    expect(broken.texts()).toEqual([es.errors.generic]);
    expect(await count("bot_sessions")).toBe(0);
    await broken.db.destroy();
  });
});
