import type { components } from "@/shared/api/schema";

// `has_active_role` (F034) viaja en el 409 genérico del contrato; no está en la lista del esquema y api/openapi.yaml no cambia.
export type ErrorCode = components["schemas"]["ErrorCode"] | "has_active_role";
export type FieldError = components["schemas"]["FieldError"];

// Error esperado de un servicio: lleva el código del contrato y el estado HTTP que le corresponde.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly errors?: FieldError[],
    readonly options: { detail?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}
