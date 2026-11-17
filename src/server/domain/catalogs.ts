// Listas cerradas (F011): categorías, tipos de experiencia y tipos de establecimiento.

// UUID fijo del tipo de experiencia gastronómica "Sabores de Caldas" que carga la semilla (ADR 0011). Se reconoce por esta
// fila, nunca por el nombre, porque el administrador puede renombrarlo en M11.
export const GASTRONOMIC_EXPERIENCE_TYPE_ID = "5a0b0e50-0000-4000-8000-000000000001";

// Máximo del nombre visible (D-119).
export const CATALOG_NAME_MAX = 100;

// Clave de comparación para detectar duplicados (D-118): sin espacios sobrantes, espacios repetidos en uno, minúsculas y sin tildes.
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export type NameProblem = "required" | "invalid_type" | "too_long" | "control_characters";

// Valida el nombre y devuelve el nombre visible (solo con los espacios de los extremos recortados) o el problema.
export function parseCatalogName(raw: unknown): { name: string } | { problem: NameProblem } {
  if (typeof raw !== "string") return { problem: "invalid_type" };
  const name = raw.trim();
  if (name === "") return { problem: "required" };
  if (/\p{Cc}/u.test(name)) return { problem: "control_characters" };
  if ([...name].length > CATALOG_NAME_MAX) return { problem: "too_long" };
  return { name };
}
