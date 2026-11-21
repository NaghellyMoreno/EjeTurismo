/* eslint-disable @typescript-eslint/no-explicit-any -- esquema OpenAPI sin tipar */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// F027, criterio 17: los esquemas visibles al visitante y a otro prestador no declaran propiedades de identidad ni documento.
// Nombres reales en api/openapi.yaml: PublicListingDetail (getPublishedListing), PublicListingSummary (listPublishedListings),
// ManagedListing, OwnProviderRegistration (getMyProviderRegistration), Problem y Me (getMe).
const SCHEMAS = ["PublicListingDetail", "PublicListingSummary", "ManagedListing", "OwnProviderRegistration", "Problem", "Me"] as const;
const FORBIDDEN = /identity|document|documento/i;
const spec = parse(readFileSync("api/openapi.yaml", "utf8")) as { components: { schemas: Record<string, any> } };
const dts = readFileSync("src/shared/api/schema.d.ts", "utf8");

// Todas las propiedades declaradas por el esquema, siguiendo $ref, allOf, oneOf, anyOf, items y propiedades anidadas.
function propertyNames(name: string, seen = new Set<string>()): string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const names: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.$ref === "string") names.push(...propertyNames(node.$ref.split("/").pop()!, seen));
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      names.push(key);
      walk(child);
    }
    for (const part of [...(node.allOf ?? []), ...(node.oneOf ?? []), ...(node.anyOf ?? [])]) walk(part);
    walk(node.items);
    walk(node.additionalProperties);
  };
  walk(spec.components.schemas[name]);
  return names;
}

// Bloque `Name: {` de components.schemas en schema.d.ts (de su línea a la llave de cierre con la misma sangría).
function typeBlock(name: string): string[] {
  const lines = dts.split("\n");
  const start = lines.findIndex((l) => l === `        ${name}: {`);
  expect(start, `${name} existe en schema.d.ts`).toBeGreaterThan(-1);
  const end = lines.findIndex((l, i) => i > start && l === "        };");
  return lines.slice(start + 1, end);
}

describe("criterio 17: esquemas sin propiedades de identidad ni documento", () => {
  it.each(SCHEMAS)("api/openapi.yaml: %s", (name) => {
    expect(spec.components.schemas[name], `${name} existe`).toBeTruthy();
    const names = propertyNames(name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  it.each(SCHEMAS)("src/shared/api/schema.d.ts: %s", (name) => {
    const properties = typeBlock(name)
      .map((l) => l.match(/^\s+"?([\w$-]+)"?\??:/)?.[1])
      .filter((n): n is string => Boolean(n));
    expect(properties.length).toBeGreaterThan(0);
    expect(properties.filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  it("el detector sí ve las propiedades de identidad del esquema del administrador", () => {
    const admin = Object.keys(spec.components.schemas).filter((k) => k.startsWith("AdminProviderRegistration"));
    expect(admin.flatMap((k) => propertyNames(k)).some((n) => FORBIDDEN.test(n))).toBe(true);
  });
});
