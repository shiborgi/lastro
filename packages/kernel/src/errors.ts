/**
 * The error base every module extends, and the Result value constructors
 * return.
 *
 * An error carries a stable `code` and the status both surfaces answer with.
 * `details` holds what a caller needs to act on the refusal, as plain data.
 * A module defines its own subclasses beside the rule that throws them.
 */
export class LastroError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly status = 400,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "LastroError";
  }
}

/** A request that parsed but asks for something a rule does not allow. */
export class InvalidRequestError extends LastroError {
  constructor(message: string) {
    super("INVALID_REQUEST", message, 400);
    this.name = "InvalidRequestError";
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

/* One answer for "not yours" and "not there", so a caller cannot probe for ids. */
export class UnauthorizedError extends LastroError {
  constructor() {
    super("UNAUTHORIZED_OR_NOT_FOUND", "UNAUTHORIZED_OR_NOT_FOUND", 404);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends LastroError {
  constructor(message = "CONFLICT") {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class InvalidMoneyError extends LastroError {
  constructor(message: string) {
    super("INVALID_MONEY", message, 400);
    this.name = "InvalidMoneyError";
  }
}

export class InvalidDateError extends LastroError {
  constructor(value: string) {
    super("INVALID_DATE", `invalid calendar date: ${value}`, 400);
    this.name = "InvalidDateError";
  }
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: LastroError };
