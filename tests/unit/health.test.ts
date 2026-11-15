import { describe, expect, it } from "vitest";
import { getHealth } from "@/server/health";
import { GET } from "@/app/api/health/route";
import { homeTitle } from "@/miniapp/home";

describe("salud del backend", () => {
  it("informa estado ok con la hora dada", () => {
    expect(getHealth(new Date("2026-11-15T00:00:00Z"))).toEqual({ status: "ok", timestamp: "2026-11-15T00:00:00.000Z" });
  });
  it("el endpoint responde 200 con estado ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});

describe("página inicial", () => {
  it("muestra el nombre del producto", () => {
    expect(homeTitle).toBe("Eje Turismo");
  });
});
