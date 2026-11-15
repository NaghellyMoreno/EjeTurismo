import type { components } from "@/shared/api/schema";

export type ErrorCode = components["schemas"]["ErrorCode"];
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
