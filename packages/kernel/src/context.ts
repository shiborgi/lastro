/**
 * Who is acting, on which Book, and what that role may do.
 *
 * The role matrix is the whole access model: there are no per-record
 * permissions. An operation declares one access level and the role decides.
 */
import { ForbiddenError, InvalidExecutionContextError } from "./errors";

export const roles = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
export type Role = (typeof roles)[number];

export const sources = ["WEB", "API", "MCP", "WORKER"] as const;
export type Source = (typeof sources)[number];

export const actorTypes = ["USER", "ASSISTANT", "SYSTEM"] as const;
export type ActorType = (typeof actorTypes)[number];

/*
 * `read` is open to every member. `write` is bookkeeping: recording and
 * correcting financial and sales facts. `admin` governs who and what may act
 * on the Book, such as agent credentials.
 */
export const accessLevels = ["read", "write", "admin"] as const;
export type Access = (typeof accessLevels)[number];

/** An authenticated caller outside any Book. */
export type UserContext = {
  actorId: string;
  source: Source;
  correlationId: string;
  actorType?: ActorType;
  agentPrincipal?: string;
  delegatedOperator?: string;
};

/** A caller acting on one Book, with the role its membership grants. */
export type ExecutionContext = UserContext & {
  bookId: string;
  role: Role;
  idempotencyKey?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertUserContext(input: unknown): UserContext {
  if (!input || typeof input !== "object") {
    throw new InvalidExecutionContextError("context");
  }
  const context = input as Record<string, unknown>;
  for (const field of ["actorId", "source", "correlationId"]) {
    if (!isNonEmptyString(context[field])) {
      throw new InvalidExecutionContextError(field);
    }
  }
  if (!sources.includes(context.source as Source)) {
    throw new InvalidExecutionContextError("source");
  }
  return context as unknown as UserContext;
}

export function assertExecutionContext(input: unknown): ExecutionContext {
  const context = assertUserContext(input) as Record<string, unknown>;
  if (!isNonEmptyString(context.bookId)) {
    throw new InvalidExecutionContextError("bookId");
  }
  if (!roles.includes(context.role as Role)) {
    throw new InvalidExecutionContextError("role");
  }
  return context as unknown as ExecutionContext;
}

export function canAccess(role: Role, access: Access): boolean {
  if (access === "read") return true;
  if (role === "OWNER" || role === "ADMIN") return true;
  return role === "EDITOR" && access === "write";
}

export function assertAccess(context: ExecutionContext, access: Access): void {
  if (!canAccess(context.role, access)) throw new ForbiddenError();
}
