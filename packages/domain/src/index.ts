export const roles = ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const;
export type Role = (typeof roles)[number];

export const sources = ["WEB", "API", "MCP", "WORKER"] as const;
export type Source = (typeof sources)[number];

export const actorTypes = ["USER", "ASSISTANT", "SYSTEM"] as const;
export type ActorType = (typeof actorTypes)[number];

export type ExecutionContext = {
  actorId: string;
  bookId: string;
  role: Role;
  source: Source;
  correlationId: string;
  idempotencyKey?: string;
  actorType?: ActorType;
  agentPrincipal?: string;
  delegatedOperator?: string;
};

export const operations = {
  listBooks: "LIST_BOOKS",
  listAccounts: "LIST_ACCOUNTS",
  createAccount: "CREATE_ACCOUNT",
  deleteAccount: "DELETE_ACCOUNT",
  listParties: "LIST_PARTIES",
  createParty: "CREATE_PARTY",
  deleteParty: "DELETE_PARTY",
  listExpenseCategories: "LIST_EXPENSE_CATEGORIES",
  createExpenseCategory: "CREATE_EXPENSE_CATEGORY",
  deleteExpenseCategory: "DELETE_EXPENSE_CATEGORY",
  listRevenueCategories: "LIST_REVENUE_CATEGORIES",
  createRevenueCategory: "CREATE_REVENUE_CATEGORY",
  createExpense: "CREATE_EXPENSE",
  listExpenses: "LIST_EXPENSES",
  manageMembers: "MANAGE_MEMBERS",
  manageAgentCredentials: "MANAGE_AGENT_CREDENTIALS",
} as const;

export type Operation = (typeof operations)[keyof typeof operations];

const readOperations = new Set<Operation>([
  operations.listBooks,
  operations.listAccounts,
  operations.listParties,
  operations.listExpenseCategories,
  operations.listRevenueCategories,
  operations.listExpenses,
]);

const financialWriteOperations = new Set<Operation>([
  operations.createAccount,
  operations.deleteAccount,
  operations.createParty,
  operations.deleteParty,
  operations.createExpenseCategory,
  operations.deleteExpenseCategory,
  operations.createRevenueCategory,
  operations.createExpense,
]);

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertExecutionContext(input: unknown): ExecutionContext {
  if (!input || typeof input !== "object") {
    throw new InvalidExecutionContextError("context");
  }
  const context = input as Record<string, unknown>;
  for (const field of [
    "actorId",
    "bookId",
    "role",
    "source",
    "correlationId",
  ]) {
    if (!isNonEmptyString(context[field])) {
      throw new InvalidExecutionContextError(field);
    }
  }
  if (!roles.includes(context.role as Role)) {
    throw new InvalidExecutionContextError("role");
  }
  if (!sources.includes(context.source as Source)) {
    throw new InvalidExecutionContextError("source");
  }
  return context as unknown as ExecutionContext;
}

export function canPerform(role: Role, operation: Operation): boolean {
  if (readOperations.has(operation)) return true;
  if (role === "OWNER") return true;
  if (role === "ADMIN") return true;
  if (role === "EDITOR") return financialWriteOperations.has(operation);
  return false;
}

export function assertAuthorized(
  context: ExecutionContext,
  operation: Operation,
): void {
  if (!canPerform(context.role, operation)) throw new ForbiddenError();
}

export type Book = {
  id: string;
  name: string;
  createdAt?: Date;
};

export type Account = {
  id: string;
  bookId: string;
  name: string;
  type: string;
  createdAt?: Date;
};

export type Party = {
  id: string;
  bookId: string;
  name: string;
  type: string;
  createdAt?: Date;
};

export type ExpenseCategory = {
  id: string;
  bookId: string;
  name: string;
  createdAt?: Date;
};

export type RevenueCategory = {
  id: string;
  bookId: string;
  name: string;
  createdAt?: Date;
};

export type Expense = {
  id: string;
  bookId: string;
  accountId: string;
  partyId: string;
  expenseCategoryId: string;
  createdAt?: Date;
};

export type AuditEvent = {
  id?: string;
  actorType: ActorType;
  actorPrincipal: string;
  delegatedOperator: string;
  bookId: string;
  source: Source;
  correlationId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
};
