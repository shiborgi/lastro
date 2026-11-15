/**
 * An operation: one capability of a module, declared once (ADR 12).
 *
 * The descriptor is plain data and schemas, safe to load in a browser. The
 * HTTP adapter, the MCP adapter, the web client and the web proxy allowlist
 * are all derived from it, so a capability cannot exist on one surface and
 * be missing or different on another.
 */
import type { z } from "zod";
import type { Access, ExecutionContext, UserContext } from "./context";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/*
 * A `book` operation acts on one Book as a member of it. A `user` operation
 * runs for an authenticated caller outside any Book, and may only read.
 */
export type OperationScope = "book" | "user";

export type ContextOf<S extends OperationScope> = S extends "user"
  ? UserContext
  : ExecutionContext;

export type OperationDescriptor<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
  S extends OperationScope = OperationScope,
> = Readonly<{
  /** `<module>.<name>`, unique across the host. */
  id: string;
  scope: S;
  access: Access;
  /** Removes or reverses a record; the MCP adapter demands confirmation. */
  destructive: boolean;
  input: I;
  output: O;
  /** `path` is relative to the Book (`book` scope) or to the API root. */
  http: Readonly<{ method: HttpMethod; path: string }>;
  mcp: Readonly<{ name: string; description: string }>;
}>;

type OperationInput<
  I extends z.ZodType,
  O extends z.ZodType,
  S extends OperationScope,
> = {
  id: string;
  scope?: S;
  access: Access;
  destructive?: boolean;
  input: I;
  output: O;
  http: { method: HttpMethod; path: string };
  mcp: { name: string; description: string };
};

const OPERATION_ID = /^[a-z][a-z0-9-]*\.[a-z][A-Za-z0-9]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const HTTP_PATH = /^(\/(:?[A-Za-z][A-Za-z0-9-]*))+$/;

export function defineOperation<
  I extends z.ZodType,
  O extends z.ZodType,
  S extends OperationScope = "book",
>(definition: OperationInput<I, O, S>): OperationDescriptor<I, O, S> {
  const { id, access, http, mcp } = definition;
  const scope = (definition.scope ?? "book") as S;
  const destructive = definition.destructive ?? false;
  const refuse = (reason: string): never => {
    throw new Error(`operation ${id}: ${reason}`);
  };
  if (!OPERATION_ID.test(id)) refuse("id must be <module>.<camelCaseName>");
  if (!TOOL_NAME.test(mcp.name)) refuse("the MCP tool name must be snake_case");
  if (!mcp.description.trim()) refuse("the MCP tool needs a description");
  if (!HTTP_PATH.test(http.path)) refuse(`invalid HTTP path ${http.path}`);
  if (http.method === "GET" && access !== "read") refuse("a GET cannot write");
  if (access === "read" && http.method !== "GET")
    refuse("a read is published as GET");
  if (access === "read" && destructive) refuse("a read cannot be destructive");
  if (scope === "user" && access !== "read")
    refuse("a user-scope operation may only read");
  return Object.freeze({
    id,
    scope,
    access,
    destructive,
    input: definition.input,
    output: definition.output,
    http: Object.freeze({ ...http }),
    mcp: Object.freeze({ ...mcp }),
  });
}

/** What a write records about itself; the envelope adds who, where and when. */
export type AuditEntry = {
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown>;
};

/**
 * The unit of work an operation runs in. A module passes it on when it calls
 * another module, so both commit or roll back together.
 */
export type Scope<C extends UserContext = ExecutionContext> = Readonly<{
  context: C;
  /** The connection or open transaction; only database adapters look inside. */
  handle: unknown;
  /** Record an audit event that commits with this write. */
  audit(entry: AuditEntry): void;
}>;

export type OperationHandler<
  I extends z.ZodType = z.ZodType,
  S extends OperationScope = OperationScope,
> = (args: {
  scope: Scope<ContextOf<S>>;
  input: z.output<I>;
}) => Promise<unknown>;

export type BoundOperation = Readonly<{
  descriptor: OperationDescriptor;
  // biome-ignore lint/suspicious/noExplicitAny: handlers of different inputs share one list
  handler: OperationHandler<any, any>;
}>;

/** Pair a descriptor with the handler that answers it. */
export function bind<
  I extends z.ZodType,
  O extends z.ZodType,
  S extends OperationScope,
>(
  descriptor: OperationDescriptor<I, O, S>,
  handler: OperationHandler<I, S>,
): BoundOperation {
  return Object.freeze({
    descriptor: descriptor as unknown as OperationDescriptor,
    handler,
  });
}

/**
 * Runs every operation: authorization, and for a write the transaction,
 * idempotency and audit (ADR 11). The `core` module provides it. `work`
 * returns the operation's wire result, which is what an idempotent replay
 * answers with.
 */
export type Envelope = {
  run<T>(
    descriptor: OperationDescriptor,
    context: UserContext | ExecutionContext,
    work: (scope: Scope<UserContext>) => Promise<T>,
  ): Promise<T>;
};
