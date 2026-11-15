import { describe, expect, it } from "vitest";
import { parseAdminCallback } from "@/bot/admin";
import { formatBogotaShort } from "@/lib/time";
import { redact } from "@/server/observability/logger";

const ID = "3f2b8c1e-5d4a-4b7e-9a10-1c2d3e4f5a6b";

describe("callback_data del administrador (F003, criterio 33)", () => {
  it("reconoce la lista y cada acción con un UUID, y cabe en 64 bytes", () => {
    expect(parseAdminCallback("adm:list")).toEqual({ action: "list" });
    for (const [prefix, action] of [["a", "approve"], ["r", "reject"], ["ca", "confirmApprove"], ["cr", "confirmReject"], ["x", "cancel"]]) {
      const data = `adm:${prefix}:${ID}`;
      expect(parseAdminCallback(data)).toEqual({ action, id: ID });
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    }
  });
  it.each(["", "adm:", "adm:a:", "adm:a:123", `adm:q:${ID}`, `adm:a:${ID}x`, "adm:list:x"])("rechaza %j", (data) => {
    expect(parseAdminCallback(data)).toBeNull();
  });
});

describe("fecha del bot en Bogotá (F003, criterio 2)", () => {
  it("DD/MM/AAAA HH:mm con cambio de día respecto de UTC", () => {
    expect(formatBogotaShort(new Date("2026-11-16T03:30:00Z"))).toBe("15/11/2026 22:30");
    expect(formatBogotaShort(new Date("2026-01-02T05:05:00Z"))).toBe("02/01/2026 00:05");
  });
});

describe("logger: claves de F003 (criterio 35)", () => {
  it("redacta reason, rejectionReason, callback_data y payload", () => {
    const out = JSON.stringify(redact({ reason: "motivo-x", rejectionReason: "motivo-y", callback_data: "adm:a:id", payload: { n: "1020304050" }, ok: 1 }));
    for (const secret of ["motivo-x", "motivo-y", "adm:a:id", "1020304050"]) expect(out).not.toContain(secret);
    expect(out).toContain('"ok":1');
  });
});
