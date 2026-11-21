import { describe, expect, it } from "vitest";
import { EXPECTED_OPERATION_IDS, PROTECTED_OPERATIONS } from "../helpers/protected-operations";
import { ADMIN_OPERATION_IDS, ROLE_CASES, ROLE_DENIAL_OPERATIONS, ROUTED_OPERATION_IDS, UNROUTED_OPERATION_IDS, operationIdsWithRoute, roleOperations } from "../helpers/role-denial";

// F013, criterio 31: las cifras de las matrices de F007 y F009 tras agregar las 4 operaciones nuevas (falla con el operationId).
const F013 = ["listManagedListings", "getManagedListing", "saveListingDraft", "submitListingForReview"];

describe("criterio 31: PROTECTED_OPERATIONS y ROLE_DENIAL_OPERATIONS", () => {
  it("la matriz de F009 tiene 39 operaciones (las 4 de F013, las 4 de F014, la de F029, las 4 de F020 y la de F030 entran con su rol)", () => {
    const ids = PROTECTED_OPERATIONS.map((o) => o.operationId);
    process.stdout.write(`PROTECTED_OPERATIONS (${ids.length}): ${ids.join(", ")}\n`);
    expect(PROTECTED_OPERATIONS).toHaveLength(39);
    expect(ids.filter((id) => !EXPECTED_OPERATION_IDS.includes(id)), "sobran").toEqual([]);
    expect(EXPECTED_OPERATION_IDS.filter((id) => !ids.includes(id)), "faltan").toEqual([]);
    for (const id of F013) expect(ids, id).toContain(id);
    expect(PROTECTED_OPERATIONS.filter((o) => o.role === "provider").map((o) => o.operationId).sort()).toEqual(["createPhotoUpload", "getManagedListing", "registerPhoto", "removePhoto", "saveListingDraft", "submitListingForReview"]);
    expect(PROTECTED_OPERATIONS.find((o) => o.operationId === "saveListingDraft")!.method).toBe("PUT");
    expect(PROTECTED_OPERATIONS.find((o) => o.operationId === "listManagedListings")!.role).toBe("admin");
  });

  it("ROLE_DENIAL_OPERATIONS tiene 31 entradas: 27 con ruta y 4 sin ruta; ADMIN_OPERATION_IDS sigue en 14", () => {
    expect(ROLE_DENIAL_OPERATIONS).toHaveLength(31);
    expect(ROLE_DENIAL_OPERATIONS.filter((e) => e.hasRoute)).toHaveLength(27);
    expect(ROLE_DENIAL_OPERATIONS.filter((e) => !e.hasRoute)).toHaveLength(4);
    expect(ADMIN_OPERATION_IDS).toHaveLength(14);
    expect(ROUTED_OPERATION_IDS).toHaveLength(27);
    expect(UNROUTED_OPERATION_IDS).toHaveLength(4);
    for (const id of F013) expect(ROUTED_OPERATION_IDS, id).toContain(id);
    for (const id of F013) expect(UNROUTED_OPERATION_IDS, id).not.toContain(id);
  });

  it("las operaciones de rol con route.ts del repositorio son las 27 de la matriz", () => {
    const withRoute = operationIdsWithRoute();
    expect(roleOperations().filter((o) => withRoute.has(o.operationId)).map((o) => o.operationId).sort()).toEqual([...ROUTED_OPERATION_IDS].sort());
    expect(ROLE_CASES).toHaveLength(28);
  });
});
