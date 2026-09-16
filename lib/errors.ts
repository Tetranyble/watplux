/**
 * Generic, framework-agnostic error hierarchy.
 *
 * Foundation only — deliberately has no business-specific subclasses
 * (e.g. no `InsufficientStockError`, `PaymentVerificationError`). Those
 * belong to their owning module's `domain/` layer in later phases, per
 * docs/ARCHITECTURE.md §1. This file exists so every layer has one
 * consistent shape to throw and catch.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(
    message: string,
    options: { code: string; statusCode?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input", cause?: unknown) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, cause });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", cause?: unknown) {
    super(message, { code: "NOT_FOUND", statusCode: 404, cause });
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", cause?: unknown) {
    super(message, { code: "UNAUTHORIZED", statusCode: 401, cause });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", cause?: unknown) {
    super(message, { code: "FORBIDDEN", statusCode: 403, cause });
    this.name = "ForbiddenError";
  }
}

/** Generic "the write conflicted with existing data" error (e.g. a unique
 * constraint race on SKU/slug) — HTTP 409. Not business-specific, so it
 * lives here rather than in a module's domain layer, per
 * docs/PHASE_4_CATALOG_PLAN.md §12a. */
export class ConflictError extends AppError {
  constructor(message = "Conflict", cause?: unknown) {
    super(message, { code: "CONFLICT", statusCode: 409, cause });
    this.name = "ConflictError";
  }
}

/** True for any error this codebase deliberately threw, as opposed to an unexpected one. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Cache Components can serialize an error across a React cache boundary,
 * preserving its public `name`/`code` while dropping its prototype. Route
 * presentation must therefore not rely on `instanceof` alone when mapping a
 * deliberate domain error to a framework not-found/forbidden state. */
function matchesAppError(
  error: unknown,
  code: string,
  name: string,
): error is AppError {
  if (error instanceof AppError) return error.code === code;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === code || candidate.name === name;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return matchesAppError(error, "NOT_FOUND", "NotFoundError");
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return matchesAppError(error, "FORBIDDEN", "ForbiddenError");
}
