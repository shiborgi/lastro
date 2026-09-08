import {
  type AuditEvent,
  ConflictError,
  type ExecutionContext,
  type Money,
  assertExecutionContext,
  money,
} from "@lastro/domain";
import type { ApplicationRepository, Page } from "./types";

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
function sqlState(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function mapRepositoryError(error: unknown): never {
  // 23503: the row is still referenced by another record.
  if (sqlState(error) === "23503") throw new ConflictError();
  throw error;
}

export function method<T extends keyof ApplicationRepository>(
  repository: ApplicationRepository,
  name: T,
): NonNullable<ApplicationRepository[T]> {
  const candidate = repository[name];
  if (typeof candidate !== "function") {
    throw new Error(`repository method ${String(name)} is not configured`);
  }
  return candidate as NonNullable<ApplicationRepository[T]>;
}
