import type { Context } from "grammy";

// Utilidades comunes de los formularios conversacionales (B21): reutilizables por los formularios futuros.

// El bloqueo optimista de la sesión falló: otra actualización de la misma cuenta se adelantó (ADR 0015).
export class SessionConflictError extends Error {
  constructor() {
    super("session_conflict");
    this.name = "SessionConflictError";
  }
}

// La cuenta dejó de existir mientras se atendía la pulsación (revocación repetida o simultánea): el bot muestra el aviso (D-039).
export class AccountGoneError extends Error {
  constructor() {
    super("account_gone");
    this.name = "AccountGoneError";
  }
}

// `/cancelar` en minúsculas, solo o con el nombre del propio bot (`/cancelar@MiBot`). Cualquier otra forma es texto normal.
export function isCancelCommand(ctx: Context): boolean {
  const text = ctx.message?.text;
  if (text === undefined) return false;
  if (text === "/cancelar") return true;
  const mention = text.startsWith("/cancelar@") ? text.slice("/cancelar@".length) : null;
  return mention !== null && mention.toLowerCase() === ctx.me.username.toLowerCase();
}
