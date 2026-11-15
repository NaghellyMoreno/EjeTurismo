// Zona horaria del producto: America/Bogota (UTC-5, sin horario de verano). Los instantes se guardan en UTC y solo se
// formatean aquí (RNF-016). Se arma a mano para no depender de la versión de ICU de cada entorno.
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function bogotaParts(instant: Date) {
  const d = new Date(instant.getTime() + BOGOTA_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

// "15 de noviembre de 2026"
export function formatBogotaDate(instant: Date): string {
  const p = bogotaParts(instant);
  return `${p.day} de ${MONTHS[p.month]} de ${p.year}`;
}

// "15 de noviembre de 2026, 10:30 p. m."
export function formatBogota(instant: Date): string {
  const p = bogotaParts(instant);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const suffix = p.hour < 12 ? "a. m." : "p. m.";
  return `${formatBogotaDate(instant)}, ${hour12}:${String(p.minute).padStart(2, "0")} ${suffix}`;
}

// "15/11/2026 22:30" (DD/MM/AAAA HH:mm, 24 horas) para los mensajes del bot al administrador.
export function formatBogotaShort(instant: Date): string {
  const p = bogotaParts(instant);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(p.day)}/${two(p.month + 1)}/${p.year} ${two(p.hour)}:${two(p.minute)}`;
}
