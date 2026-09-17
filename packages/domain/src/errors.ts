/**
 * The error vocabulary, and the Result every value-object constructor returns.
 *
 * Each error carries a stable `code` the adapters map to a status; a subclass
 * exists where callers branch on it, not for every message.
 */
export class LastroError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "LastroError";
  }
}

export class InvalidExecutionContextError extends LastroError {
  constructor(field: string) {
    super("INVALID_EXECUTION_CONTEXT", `${field} is required`, 400);
    this.name = "InvalidExecutionContextError";
  }
}

export class ForbiddenError extends LastroError {
  constructor() {
    super("FORBIDDEN", "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends LastroError {
  constructor() {
    super("UNAUTHORIZED_OR_NOT_FOUND", "UNAUTHORIZED_OR_NOT_FOUND", 404);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends LastroError {
  constructor() {
    super("CONFLICT", "CONFLICT", 409);
    this.name = "ConflictError";
  }
}

export class InvalidMoneyError extends LastroError {
  constructor(message: string) {
    super("INVALID_MONEY", message, 400);
    this.name = "InvalidMoneyError";
  }
}

export class InvalidInstallmentError extends LastroError {
  constructor() {
    super("INVALID_INSTALLMENT", "INVALID_INSTALLMENT", 400);
    this.name = "InvalidInstallmentError";
  }
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: LastroError };
