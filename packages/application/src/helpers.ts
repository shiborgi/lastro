import {
  type AuditEvent,
  ConflictError,
  type ExecutionContext,
  type Money,
  assertExecutionContext,
  money,
} from "@lastro/domain";
import type { Page } from "./types";

export function page<T extends { id: string }>(
  items: T[],
  cursor: string | undefined,
  limit: number,
): Page<T> {
  const sorted = [...items].sort(
    (left, right) => Number(left.id) - Number(right.id),
  );
  const start = cursor
    ? Math.max(0, sorted.findIndex((item) => String(item.id) === cursor) + 1)
    : 0;
  const result = sorted.slice(start, start + limit);
  return {
    items: result,
    nextCursor: result.length === limit ? String(result.at(-1)?.id) : null,
  };
}

export function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

export function requirePositiveMoney(amount: bigint, currency: string): Money {
  if (typeof amount !== "bigint" || amount <= 0n) {
    throw new Error("amount must be positive");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a three-letter uppercase code");
  }
  const result = money(amount, currency);
  if (!result.ok) throw result.error;
  return result.value;
}

export function auditFor(
  context: ExecutionContext,
  action: string,
  resourceType: string,
  payload: Record<string, unknown>,
): AuditEvent {
  const actorType = context.actorType ?? "USER";
  return {
    actorType,
    actorPrincipal: context.agentPrincipal ?? context.actorId,
    delegatedOperator: context.delegatedOperator ?? context.actorId,
    bookId: context.bookId,
    source: context.source,
    correlationId: context.correlationId,
    action,
    resourceType,
    payload,
  };
}

export function contextFor(input: unknown): ExecutionContext {
  return assertExecutionContext(input);
}

/*
 * The ORM wraps driver failures, so the PostgreSQL SQLSTATE can sit one or
 * more levels down the `cause` chain. Reading only the top level silently
 * stopped recognising it after an ORM upgrade, which turned "this record is
 * still referenced" from a clean 409 into an unhandled error.
 */
function driverError(
  error: unknown,
): { code: string; message: string } | undefined {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      const message = (current as { message?: unknown }).message;
      return { code, message: typeof message === "string" ? message : "" };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function sqlState(error: unknown): string | undefined {
  return driverError(error)?.code;
}

/**
 * The database's own words, for a rule the database is the one enforcing.
 *
 * Every trigger in this schema raises a message written for whoever hit it —
 * "categories nest one level: the chosen group is already inside a group",
 * "expense settlements exceed expense total", "window overlaps the one already
 * on 2026-09". The ORM wraps all of them in `Failed query: insert into ...`,
 * so without this the operator sees SQL and the message that would have told
 * them what to do sits one level down the cause chain, unread.
 *
 * Only for the two states that mean "a rule refused this": a check violation
 * (which is what the triggers raise) and an exclusion violation. Anything else
 * keeps its own handling.
 */
export function databaseRefusal(error: unknown): string | undefined {
  const driver = driverError(error);
  if (!driver) return undefined;
  const refusals = new Set(["23514", "23P01"]);
  return refusals.has(driver.code) && driver.message
    ? driver.message
    : undefined;
}

export function mapRepositoryError(error: unknown): never {
  // 23503: the row is still referenced by another record.
  if (sqlState(error) === "23503") throw new ConflictError();
  throw error;
}

/**
 * A date that arrived as a date, or as the ISO string a transport sends.
 *
 * The financial routes convert their own dates before calling in, but a
 * catalog registration hands the parsed body straight through and casts it to
 * the command type — so a `Date` field there actually receives a string, and
 * the cast means neither compiler notices. This is the one place that covers
 * both transports, so the conversion lives here rather than being written
 * twice and remembered a third time.
 */
export function dateInput(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${field} is not a date: "${String(value)}"`);
  }
  return parsed;
}
