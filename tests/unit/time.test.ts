import { describe, expect, it } from "vitest";
import { formatBogota, formatBogotaDate } from "@/lib/time";

describe("formatBogota (criterio 19)", () => {
  it("muestra un instante UTC en America/Bogota (UTC-5)", () => {
    expect(formatBogota(new Date("2026-11-16T03:30:00Z"))).toBe("15 de noviembre de 2026, 10:30 p. m.");
  });
  it("formatea mediodía, medianoche y mañana con a. m. y p. m.", () => {
    expect(formatBogota(new Date("2026-11-15T17:05:00Z"))).toBe("15 de noviembre de 2026, 12:05 p. m.");
    expect(formatBogota(new Date("2026-11-15T05:00:00Z"))).toBe("15 de noviembre de 2026, 12:00 a. m.");
    expect(formatBogota(new Date("2026-03-01T14:09:00Z"))).toBe("1 de marzo de 2026, 9:09 a. m.");
  });
  it("la fecha sola cambia de día según Bogotá, no según UTC", () => {
    expect(formatBogotaDate(new Date("2026-11-16T03:30:00Z"))).toBe("15 de noviembre de 2026");
    expect(formatBogotaDate(new Date("2026-11-15T05:00:00Z"))).toBe("15 de noviembre de 2026");
    expect(formatBogotaDate(new Date("2026-11-15T04:59:59Z"))).toBe("14 de noviembre de 2026");
  });
});
