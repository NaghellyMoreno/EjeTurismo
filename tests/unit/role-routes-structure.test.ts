import { describe, expect, it } from "vitest";
import { PROTECTED_OPERATIONS } from "../helpers/protected-operations";
import {
  ADMIN_OPERATION_IDS,
  PERSON_KEYS,
  ROLE_CASES,
  ROLE_DENIAL_OPERATIONS,
  ROUTED_OPERATION_IDS,
  UNROUTED_OPERATION_IDS,
  operationIdsWithRoute,
  roleOperations,
} from "../helpers/role-denial";

// F007, criterios 15 y 16: ninguna ruta de rol (admin o provider) queda fuera de la matriz de acceso denegado.
const withRoute = operationIdsWithRoute();
const roleOps = roleOperations();

describe("F007 criterio 15: cobertura estructural de rutas de rol", () => {
  it("las operaciones de rol sin route.ts son exactamente las 12 del contrato", () => {
    const without = roleOps.filter((o) => !withRoute.has(o.operationId)).map((o) => o.operationId);
    expect(without).toHaveLength(12);
    expect(without.sort()).toEqual([...UNROUTED_OPERATION_IDS].sort());
  });

  it("las operaciones de rol con route.ts son exactamente las 19 (14 de administrador, createListing y las 4 de F013)", () => {
    const withRoutes = roleOps.filter((o) => withRoute.has(o.operationId)).map((o) => o.operationId);
    expect(withRoutes).toHaveLength(19);
    expect(withRoutes.sort()).toEqual([...ROUTED_OPERATION_IDS].sort());
  });

  it("toda operación de rol con ruta figura en ROLE_DENIAL_OPERATIONS con hasRoute y tiene su caso (falla con el nombre)", () => {
    for (const op of roleOps.filter((o) => withRoute.has(o.operationId))) {
      const found = ROLE_DENIAL_OPERATIONS.find((e) => e.operationId === op.operationId);
      expect(found, `${op.operationId} tiene route.ts y no figura en ROLE_DENIAL_OPERATIONS`).toBeDefined();
      expect(found!.hasRoute, `${op.operationId} tiene route.ts y hasRoute es false`).toBe(true);
      expect(ROLE_CASES.some((c) => c.operationId === op.operationId), `${op.operationId} no tiene caso en ROLE_CASES`).toBe(true);
    }
  });

  it("las 14 operaciones de administrador salen de PROTECTED_OPERATIONS (role admin) y del openapi (x-roles exactamente admin)", () => {
    const fromMatrix = PROTECTED_OPERATIONS.filter((o) => o.role === "admin").map((o) => o.operationId);
    const fromSpec = roleOps.filter((o) => o.roles.length === 1 && o.roles[0] === "admin" && withRoute.has(o.operationId)).map((o) => o.operationId);
    // F012: `createListing` entra a la matriz de F009 con role admin, pero su x-roles es provider y admin. F013: lo mismo con
    // `listManagedListings` (x-roles provider y admin). `fromSpec` no cambia: sigue igual a ADMIN_OPERATION_IDS.
    expect(fromMatrix.sort()).toEqual([...ADMIN_OPERATION_IDS, "createListing", "listManagedListings"].sort());
    expect(fromSpec.sort()).toEqual([...ADMIN_OPERATION_IDS].sort());
  });
});

describe("F007 criterio 16: forma de ROLE_DENIAL_OPERATIONS", () => {
  it("cada entrada tiene operationId, roles, hasRoute y A1 a A5 completos", () => {
    for (const e of ROLE_DENIAL_OPERATIONS) {
      expect(e.operationId).toBeTruthy();
      expect(e.roles.length, e.operationId).toBeGreaterThan(0);
      expect(typeof e.hasRoute, e.operationId).toBe("boolean");
      expect(Object.keys(e.deniedPersons).sort(), e.operationId).toEqual([...PERSON_KEYS].sort());
      for (const k of PERSON_KEYS) expect(e.deniedPersons[k].status, `${e.operationId} ${k}`).toBe(403);
    }
  });

  it("A1 y A3 esperan consent_required; A2, A4 y A5 esperan forbidden", () => {
    const e = ROLE_DENIAL_OPERATIONS[0].deniedPersons;
    expect([e.A1.code, e.A2.code, e.A3.code, e.A4.code, e.A5.code]).toEqual(["consent_required", "forbidden", "consent_required", "forbidden", "forbidden"]);
  });

  it("las 19 con ruta declaran hasRoute true y las 12 sin ruta hasRoute false", () => {
    expect(ROLE_DENIAL_OPERATIONS).toHaveLength(31);
    expect(ROLE_DENIAL_OPERATIONS.filter((e) => e.hasRoute).map((e) => e.operationId).sort()).toEqual([...ROUTED_OPERATION_IDS].sort());
    expect(ROLE_DENIAL_OPERATIONS.filter((e) => !e.hasRoute).map((e) => e.operationId).sort()).toEqual([...UNROUTED_OPERATION_IDS].sort());
  });

  it("los roles declarados coinciden con x-roles del openapi", () => {
    for (const e of ROLE_DENIAL_OPERATIONS) {
      const spec = roleOps.find((o) => o.operationId === e.operationId)!;
      expect([...e.roles].sort(), e.operationId).toEqual(spec.roles.filter((r) => r === "admin" || r === "provider").sort());
    }
  });

  it("los casos de ROLE_CASES son los 20 (14 de administrador, createListing dos veces y las 4 de F013)", () => {
    expect(ROLE_CASES).toHaveLength(20);
    expect(ROLE_CASES.map((c) => c.operationId).sort()).toEqual([...ROUTED_OPERATION_IDS, "createListing"].sort());
  });
});
