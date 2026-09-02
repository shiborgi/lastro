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

export type Money = Readonly<{ minor: bigint; currency: string }>;

export function money(minor: bigint, currency: string): Result<Money> {
  if (minor < 0n || !currency.trim()) {
    return {
      ok: false,
      error: new InvalidMoneyError("minor and currency are required"),
    };
  }
  return { ok: true, value: Object.freeze({ minor, currency }) };
}

export function addMoney(left: Money, right: Money): Result<Money> {
  if (left.currency !== right.currency) {
    return { ok: false, error: new InvalidMoneyError("currency mismatch") };
  }
  return money(left.minor + right.minor, left.currency);
}

export type Installment = Readonly<{ number: number; count: number }>;

export function installment(
  number: number,
  count: number,
): Result<Installment> {
  if (
    !Number.isInteger(number) ||
    !Number.isInteger(count) ||
    number < 1 ||
    count < 1 ||
    number > count
  ) {
    return { ok: false, error: new InvalidInstallmentError() };
  }
  return { ok: true, value: Object.freeze({ number, count }) };
}

export type Settlement = Readonly<{ amount: Money; voidedAt?: Date | null }>;
export type FinancialStatus = "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";

export function settledAmount(
  currency: string,
  settlements: readonly Settlement[],
): Result<Money> {
  let total = 0n;
  for (const settlement of settlements) {
    if (settlement.voidedAt) continue;
    if (settlement.amount.currency !== currency) {
      return { ok: false, error: new InvalidMoneyError("currency mismatch") };
    }
    total += settlement.amount.minor;
  }
  return money(total, currency);
}

export function financialStatus(
  total: Money,
  settlements: readonly Settlement[],
): Result<FinancialStatus> {
  const settled = settledAmount(total.currency, settlements);
  if (!settled.ok) return settled;
  if (settled.value.minor === 0n) return { ok: true, value: "OPEN" };
  return {
    ok: true,
    value: settled.value.minor >= total.minor ? "SETTLED" : "PARTIALLY_SETTLED",
  };
}

export function availableBalance(
  total: Money,
  settlements: readonly Settlement[],
): Result<Money> {
  const settled = settledAmount(total.currency, settlements);
  if (!settled.ok) return settled;
  return money(
    total.minor > settled.value.minor ? total.minor - settled.value.minor : 0n,
    total.currency,
  );
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
  amountMinor?: bigint;
  currency?: string;
  installmentNumber?: number;
  installmentCount?: number;
  occurredAt?: Date;
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
