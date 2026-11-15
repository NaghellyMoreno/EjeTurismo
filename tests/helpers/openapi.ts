import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { parse } from "yaml";

// Valida cuerpos de respuesta contra los esquemas reales de api/openapi.yaml (contrato F001, criterios 5 y 35).
const addFormats = ((addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule) as typeof addFormatsModule;
const spec = parse(readFileSync(resolve(process.cwd(), "api/openapi.yaml"), "utf8")) as { components: { schemas: Record<string, unknown> } };
const defs = JSON.parse(JSON.stringify(spec.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

export function validateSchema(name: string, value: unknown): string[] {
  const validate = ajv.compile({ $ref: `#/$defs/${name}`, $defs: defs });
  return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}
