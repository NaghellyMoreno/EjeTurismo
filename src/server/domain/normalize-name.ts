// D-118: recorta espacios, junta los espacios internos repetidos en uno, pasa a minúsculas y quita tildes.
// Es la clave con la que se detectan nombres duplicados (`name_normalized`).
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
