/**
 * One mapping from anything thrown to what a caller is told (ADR 12).
 *
 * Both surfaces answer through this, so a refusal reads the same over HTTP
 * and over MCP. A rule the database enforced keeps the words its trigger was
 * written with: they exist to say what is wrong and what to do about it.
 */
import { z } from "zod";
import { LastroError } from "./errors";

export type Failure = {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

/*
 * The ORM wraps driver failures, so the PostgreSQL SQLSTATE can sit one or
 * more levels down the `cause` chain.
 */
function driverError(
  error: unknown,
): { code: string; message: string } | undefined {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      const message = (current as { message?: unknown }).message;
      return { code, message: typeof message === "string" ? message : "" };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// 23514 check violation (what the triggers raise), 23P01 exclusion violation.
const REFUSALS = new Set(["23514", "23P01"]);
// 23503 still referenced by another record, 23505 already exists.
const CONFLICTS = new Set(["23503", "23505"]);

/** The database's own words, for a rule the database is the one enforcing. */
export function databaseRefusal(error: unknown): string | undefined {
  const driver = driverError(error);
  return driver && REFUSALS.has(driver.code) && driver.message
    ? driver.message
    : undefined;
}

export function toFailure(error: unknown): Failure {
  if (error instanceof LastroError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: { ...error.details } } : {}),
    };
  }
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: issues
        .map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message,
        )
        .join("; "),
      details: { issues },
    };
  }
  const refusal = databaseRefusal(error);
  if (refusal) return { status: 409, code: "CONFLICT", message: refusal };
  const driver = driverError(error);
  if (driver && CONFLICTS.has(driver.code)) {
    return {
      status: 409,
      code: "CONFLICT",
      message:
        driver.code === "23505"
          ? "a record with the same identity already exists"
          : // PostgreSQL words the two directions of a foreign key differently.
            /^insert or update/.test(driver.message)
            ? "a record it references does not exist in this Book"
            : "the record is still referenced by another record",
    };
  }
  // Anything else is a defect, and its message may carry SQL or internals.
  return { status: 500, code: "INTERNAL", message: "internal error" };
}
