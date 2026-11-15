export function getHealth(now: Date = new Date()) {
  return { status: "ok" as const, timestamp: now.toISOString() };
}
