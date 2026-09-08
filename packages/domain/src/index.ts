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
  listInstitutions: "LIST_INSTITUTIONS",
  createInstitution: "CREATE_INSTITUTION",
  updateInstitution: "UPDATE_INSTITUTION",
  deleteInstitution: "DELETE_INSTITUTION",
  listAccounts: "LIST_ACCOUNTS",
  createAccount: "CREATE_ACCOUNT",
  updateAccount: "UPDATE_ACCOUNT",
  deleteAccount: "DELETE_ACCOUNT",
  listParties: "LIST_PARTIES",
  createParty: "CREATE_PARTY",
  updateParty: "UPDATE_PARTY",
  deleteParty: "DELETE_PARTY",
  listPartyAliases: "LIST_PARTY_ALIASES",
  createPartyAlias: "CREATE_PARTY_ALIAS",
  updatePartyAlias: "UPDATE_PARTY_ALIAS",
  deletePartyAlias: "DELETE_PARTY_ALIAS",
  listCategories: "LIST_CATEGORIES",
  createCategory: "CREATE_CATEGORY",
  updateCategory: "UPDATE_CATEGORY",
  deleteCategory: "DELETE_CATEGORY",
  createExpense: "CREATE_EXPENSE",
  listExpenses: "LIST_EXPENSES",
  voidExpenseSettlement: "VOID_EXPENSE_SETTLEMENT",
  createRevenue: "CREATE_REVENUE",
  listRevenues: "LIST_REVENUES",
  createReceipt: "CREATE_RECEIPT",
  listReceipts: "LIST_RECEIPTS",
  createRevenueSettlement: "CREATE_REVENUE_SETTLEMENT",
  listRevenueSettlements: "LIST_REVENUE_SETTLEMENTS",
  voidRevenueSettlement: "VOID_REVENUE_SETTLEMENT",
  createTransfer: "CREATE_TRANSFER",
  listTransfers: "LIST_TRANSFERS",
  listAuditEvents: "LIST_AUDIT_EVENTS",
  manageMembers: "MANAGE_MEMBERS",
  manageAgentCredentials: "MANAGE_AGENT_CREDENTIALS",
} as const;

export type Operation = (typeof operations)[keyof typeof operations];

const readOperations = new Set<Operation>([
  operations.listBooks,
  operations.listInstitutions,
  operations.listAccounts,
  operations.listParties,
  operations.listPartyAliases,
  operations.listCategories,
  operations.listExpenses,
  operations.listRevenues,
  operations.listReceipts,
  operations.listRevenueSettlements,
  operations.listTransfers,
  operations.listAuditEvents,
]);

const financialWriteOperations = new Set<Operation>([
  operations.createInstitution,
  operations.updateInstitution,
  operations.deleteInstitution,
  operations.createAccount,
  operations.updateAccount,
  operations.deleteAccount,
  operations.createParty,
  operations.updateParty,
  operations.deleteParty,
  operations.createPartyAlias,
  operations.updatePartyAlias,
  operations.deletePartyAlias,
  operations.createCategory,
  operations.updateCategory,
  operations.deleteCategory,
  operations.createExpense,
  operations.voidExpenseSettlement,
  operations.createRevenue,
  operations.createReceipt,
  operations.createRevenueSettlement,
  operations.voidRevenueSettlement,
  operations.createTransfer,
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

export type Money = Readonly<{ amount: bigint; currency: string }>;

export function money(amount: bigint, currency: string): Result<Money> {
  if (amount < 0n || !currency.trim()) {
    return {
      ok: false,
      error: new InvalidMoneyError("amount and currency are required"),
    };
  }
  return { ok: true, value: Object.freeze({ amount, currency }) };
}

export function addMoney(left: Money, right: Money): Result<Money> {
  if (left.currency !== right.currency) {
    return { ok: false, error: new InvalidMoneyError("currency mismatch") };
  }
  return money(left.amount + right.amount, left.currency);
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
    total += settlement.amount.amount;
  }
  return money(total, currency);
}

export function financialStatus(
  total: Money,
  settlements: readonly Settlement[],
): Result<FinancialStatus> {
  const settled = settledAmount(total.currency, settlements);
  if (!settled.ok) return settled;
  if (settled.value.amount === 0n) return { ok: true, value: "OPEN" };
  return {
    ok: true,
    value:
      settled.value.amount >= total.amount ? "SETTLED" : "PARTIALLY_SETTLED",
  };
}

export function availableBalance(
  total: Money,
  settlements: readonly Settlement[],
): Result<Money> {
  const settled = settledAmount(total.currency, settlements);
  if (!settled.ok) return settled;
  return money(
    total.amount > settled.value.amount
      ? total.amount - settled.value.amount
      : 0n,
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

export type Institution = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  createdAt?: Date;
};

export type Account = {
  id: string;
  bookId: string;
  key: string;
  institutionId?: string | null;
  name: string;
  type: string;
  createdAt?: Date;
};

export type Party = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  type: string;
  createdAt?: Date;
};

export type PartyAlias = {
  id: string;
  bookId: string;
  accountId: string;
  key: string;
  partyId?: string | null;
  categoryId?: string | null;
  createdAt?: Date;
};

export type AccountDate = {
  id: string;
  bookId: string;
  accountId: string;
  referenceMonth: Date;
  closeDate: Date;
  dueDate: Date;
  createdAt?: Date;
};

export type CategoryKind = "EXPENSE" | "REVENUE";

export type Category = {
  id: string;
  bookId: string;
  kind: CategoryKind;
  name: string;
  createdAt?: Date;
};

export type Expense = {
  id: string;
  bookId: string;
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  amount?: bigint;
  currency?: string;
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

export type Revenue = {
  id: string;
  bookId: string;
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  amount?: bigint;
  currency?: string;
  occurredAt?: Date;
  createdAt?: Date;
};

export type Receipt = {
  id: string;
  bookId: string;
  accountId: string;
  referenceMonth: Date;
  amount: bigint;
  currency: string;
  dueAt?: Date;
  paidAt?: Date | null;
  createdAt?: Date;
};

export type RevenueSettlement = {
  id: string;
  bookId: string;
  revenueId: string;
  receiptId: string;
  amount: bigint;
  currency: string;
  voidedAt?: Date | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt?: Date;
};

export type Payment = {
  id: string;
  bookId: string;
  accountId: string;
  referenceMonth: Date;
  amount: bigint;
  currency: string;
  dueAt?: Date;
  paidAt?: Date | null;
  createdAt?: Date;
};

export type ExpenseSettlement = {
  id: string;
  bookId: string;
  expenseId: string;
  paymentId: string;
  amount: bigint;
  currency: string;
  installmentNumber: number;
  installmentCount: number;
  voidedAt?: Date | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt?: Date;
};

export type Transfer = {
  id: string;
  bookId: string;
  key: string;
  referenceMonth: Date;
  sourceAccountId: string;
  destinationAccountId: string;
  correlationId: string;
  amount: bigint;
  currency: string;
  createdAt?: Date;
};

export function validateTransferPair(input: {
  bookId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: bigint;
  currency: string;
}): Result<{ sourceAccountId: string; destinationAccountId: string }> {
  if (!input.bookId.trim() || !input.currency.trim()) {
    return {
      ok: false,
      error: new InvalidMoneyError("bookId and currency are required"),
    };
  }
  if (input.amount <= 0n) {
    return {
      ok: false,
      error: new InvalidMoneyError("amount must be positive"),
    };
  }
  if (input.sourceAccountId === input.destinationAccountId) {
    return {
      ok: false,
      error: new LastroError(
        "INVALID_TRANSFER",
        "source and destination accounts must differ",
      ),
    };
  }
  return {
    ok: true,
    value: {
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
    },
  };
}
