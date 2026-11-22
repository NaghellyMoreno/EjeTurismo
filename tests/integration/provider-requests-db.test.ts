import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownerPool, resetDb } from "../helpers/db";
import { P1, P3, V } from "../helpers/information-request";
import { eventRows, insertRequest, replyRows, seedWorld32, statusOf, type World32 } from "../helpers/provider-requests";

// F032, criterios 12, 16 y 24 (base): disparador de estado, permisos mínimos y migración aditiva.
let owner: Pool;
let app: Pool;
let world: World32;
let r1: string;
beforeAll(() => {
  owner = ownerPool();
  app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
  await app.end();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld32(owner);
  r1 = await insertRequest(owner, { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[V] });
});

// Cambia el estado con `eje_app` fijando (o no) el actor, como lo hace el servicio dentro de la transacción.
async function update(status: string, actor: string | null) {
  const client = await app.connect();
  try {
    await client.query("begin");
    if (actor) await client.query("select set_config('app.actor_account_id', $1, true)", [actor]);
    await client.query("update app.information_requests set status = $2, updated_at = now() where id = $1", [r1, status]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

describe("criterio 12: el disparador de estado", () => {
  it("rechaza un update directo sin el dueño del negocio o con otro prestador, y no deja eventos", async () => {
    await expect(update("attended", null)).rejects.toMatchObject({ code: "P0001", message: "not_request_owner" });
    await expect(update("attended", world.accounts[P3])).rejects.toMatchObject({ code: "P0001", message: "not_request_owner" });
    await expect(update("attended", world.accounts[V])).rejects.toMatchObject({ code: "P0001" });
    expect(await statusOf(owner, r1)).toBe("new");
    expect(await eventRows(owner)).toHaveLength(0);
  });

  it("solo permite new a attended y attended a closed; no vuelve atrás ni salta", async () => {
    const p1 = world.accounts[P1];
    await expect(update("closed", p1)).rejects.toMatchObject({ message: "invalid_state_transition" });
    await update("attended", p1);
    await expect(update("new", p1)).rejects.toMatchObject({ message: "invalid_state_transition" });
    await update("closed", p1);
    for (const status of ["new", "attended"]) await expect(update(status, p1)).rejects.toMatchObject({ message: "invalid_state_transition" });
    expect(await statusOf(owner, r1)).toBe("closed");
    expect(await eventRows(owner)).toHaveLength(2);
  });

  it("un prestador con el rol revocado ya no cambia el estado", async () => {
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'provider'", [P1]);
    await expect(update("attended", world.accounts[P1])).rejects.toMatchObject({ message: "not_request_owner" });
  });
});

describe("criterio 16: solo el disparador escribe el historial", () => {
  it("eje_app no inserta, actualiza ni borra eventos (el borrado de solicitudes lo concede F037); las demás columnas de la solicitud no se actualizan", async () => {
    await update("attended", world.accounts[P1]);
    const [event] = await eventRows(owner);
    expect(event).toMatchObject({ request_id: r1, from_status: "new", to_status: "attended", actor_account_id: world.accounts[P1] });
    await expect(app.query("insert into app.information_request_status_events (request_id, from_status, to_status) values ($1, 'new', 'attended')", [r1])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update app.information_request_status_events set to_status = 'closed'")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("delete from app.information_request_status_events")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update app.information_requests set message = 'otro'")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update app.information_request_replies set body = 'otro'")).rejects.toMatchObject({ code: "42501" });
  });

  it("la respuesta solo la inserta el dueño del negocio y no sobre una solicitud cerrada", async () => {
    const insert = (account: string, request = r1) => app.query("insert into app.information_request_replies (request_id, body, sent_by_account_id) values ($1, 'Respuesta', $2)", [request, account]);
    await expect(insert(world.accounts[P3])).rejects.toMatchObject({ message: "not_request_owner" });
    await insert(world.accounts[P1]);
    const closed = await insertRequest(owner, { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[V], status: "closed" });
    await expect(insert(world.accounts[P1], closed)).rejects.toMatchObject({ message: "request_closed" });
    expect(await replyRows(owner)).toHaveLength(1);
  });
});

describe("criterio 24: migración aditiva y permisos mínimos", () => {
  const sql = () =>
    readFileSync(resolve(process.cwd(), "supabase/migrations/20261121110000_f032_information_request_replies.sql"), "utf8")
      .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

  it("es posterior a F030 y anterior a F037, y no hay drop, delete ni truncate", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations")).sort();
    expect(files.at(-2)).toBe("20261121110000_f032_information_request_replies.sql");
    expect(files.at(-1)).toBe("20261121120000_f037_request_delete.sql");
    expect(sql().replace(/on delete (cascade|set null)/gi, "")).not.toMatch(/\b(drop|delete|truncate)\b/i);
  });

  it("eje_app: update solo de status y updated_at; select e insert en respuestas; select en eventos", async () => {
    const columns = (await owner.query("select column_name from information_schema.column_privileges where table_schema = 'app' and table_name = 'information_requests' and grantee = 'eje_app' and privilege_type = 'UPDATE' order by 1")).rows.map((r) => r.column_name);
    expect(columns).toEqual(["status", "updated_at"]);
    const grants = async (table: string) =>
      (await owner.query("select privilege_type from information_schema.role_table_grants where table_schema = 'app' and table_name = $1 and grantee = 'eje_app' order by 1", [table])).rows.map((r) => r.privilege_type);
    expect(await grants("information_request_replies")).toEqual(["INSERT", "SELECT"]);
    expect(await grants("information_request_status_events")).toEqual(["SELECT"]);
    const others = (await owner.query("select grantee from information_schema.role_table_grants where table_schema = 'app' and table_name in ('information_request_replies', 'information_request_status_events') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')")).rows;
    expect(others).toEqual([]);
  });
});
