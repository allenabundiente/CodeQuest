export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super("unauthorized", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super("forbidden", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super("not_found", message, 404);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super("bad_request", message, 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super("conflict", message, 409, details);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super("quota_exceeded", message, 429, details);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super("configuration_error", message, 503);
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super("providers_unavailable", message, 503, details);
  }
}

export class SandboxUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super("sandbox_unavailable", message, 503, details);
  }
}

export class LessonGenerationFailedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("lesson_generation_failed", message, 422, details);
  }
}

export class EmailDeliveryError extends AppError {
  constructor(message: string, details?: unknown) {
    super("email_delivery_failed", message, 502, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
