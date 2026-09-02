import {
  type Account,
  type AuditEvent,
  type Book,
  ConflictError,
  type Expense,
  type ExpenseCategory,
  type FinancialStatus,
  type Money,
  type Party,
  type RevenueCategory,
  assertAuthorized,
  assertExecutionContext,
  availableBalance,
  financialStatus,
  installment,
  money,
  operations,
} from "@lastro/domain";

export type Payment = {
  id: string | number;
  bookId: string | number;
  accountId: string | number;
  partyId?: string | number | null;
  amountMinor: bigint;
  currency: string;
  occurredAt?: Date;
  createdAt?: Date;
};

export type ExpenseSettlement = {
  id: string | number;
  bookId: string | number;
  expenseId: string | number;
  paymentId: string | number;
  amountMinor: bigint;
  currency: string;
  voidedAt?: Date | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt?: Date;
};

export type FinancialExpense = Expense & {
  amountMinor: bigint;
  currency: string;
  occurredAt?: Date;
};

type CreatePaymentRepositoryInput = {
  bookId: string;
  accountId: string;
  partyId?: string | null;
  amountMinor: bigint;
  currency: string;
  occurredAt?: Date;
  idempotencyKey?: string;
};

type CreateExpenseSettlementRepositoryInput = {
  bookId: string;
  expenseId: string;
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey?: string;
};

export type ApplicationRepository = {
  listBooks?: (actorId: string, bookId?: string) => Promise<Book[]>;
  createAccount?: (
    input: Omit<Account, "id">,
    audit: AuditEvent,
  ) => Promise<Account>;
  listAccounts?: (bookId: string) => Promise<Account[]>;
  deleteAccount?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createParty?: (input: Omit<Party, "id">, audit: AuditEvent) => Promise<Party>;
  listParties?: (bookId: string) => Promise<Party[]>;
  deleteParty?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createExpenseCategory?: (
    input: Omit<ExpenseCategory, "id">,
    audit: AuditEvent,
  ) => Promise<ExpenseCategory>;
  listExpenseCategories?: (bookId: string) => Promise<ExpenseCategory[]>;
  deleteExpenseCategory?: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createRevenueCategory?: (
    input: Omit<RevenueCategory, "id">,
    audit: AuditEvent,
  ) => Promise<RevenueCategory>;
  listRevenueCategories?: (bookId: string) => Promise<RevenueCategory[]>;
  createExpense?: (
    input: Omit<Expense, "id">,
    audit: AuditEvent,
  ) => Promise<Expense>;
  listExpenses?: (bookId: string) => Promise<Expense[]>;
  createPayment?: (
    input: CreatePaymentRepositoryInput,
    audit: AuditEvent,
  ) => Promise<Payment>;
  listPayments?: (bookId: string) => Promise<Payment[]>;
  createExpenseSettlement?: (
    input: CreateExpenseSettlementRepositoryInput,
    audit: AuditEvent,
  ) => Promise<ExpenseSettlement>;
  voidExpenseSettlement?: (
    input: {
      bookId: string;
      id: string;
      voidedBy: string;
      voidReason?: string;
    },
    audit: AuditEvent,
  ) => Promise<ExpenseSettlement>;
  getExpense?: (bookId: string, id: string) => Promise<FinancialExpense | null>;
  listExpenseSettlements?: (
    bookId: string,
    expenseId: string,
  ) => Promise<ExpenseSettlement[]>;
  listPendingExpenses?: (bookId: string) => Promise<FinancialExpense[]>;
};

export type CommandContext = { context: unknown };

export type CreateAccountCommand = CommandContext & {
  name: string;
  type: string;
};

export type CreatePartyCommand = CommandContext & {
  name: string;
  type: string;
};

export type CreateCategoryCommand = CommandContext & { name: string };

export type CreateExpenseCommand = CommandContext & {
  accountId: string;
  partyId: string;
  expenseCategoryId: string;
  amountMinor?: bigint;
  currency?: string;
  installmentNumber?: number;
  installmentCount?: number;
  occurredAt?: Date;
};

export type DeleteCommand = CommandContext & { id: string };

export type CreatePaymentCommand = CommandContext & {
  accountId: string;
  partyId?: string | null;
  amountMinor: bigint;
  currency: string;
  occurredAt?: Date;
};

export type CreateExpenseSettlementCommand = CommandContext & {
  expenseId: string;
  paymentId: string;
  amountMinor: bigint;
  currency: string;
};

export type VoidExpenseSettlementCommand = CommandContext & {
  id: string;
  voidReason?: string;
};

export type ExpenseQuery = CommandContext & { id: string };

function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required`);
  return value;
}

function requirePositiveMoney(amountMinor: bigint, currency: string): Money {
  if (typeof amountMinor !== "bigint" || amountMinor <= 0n) {
    throw new Error("amountMinor must be positive");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("currency must be a three-letter uppercase code");
  }
  const result = money(amountMinor, currency);
  if (!result.ok) throw result.error;
  return result.value;
}

function requireExpense(expense: FinancialExpense | null): FinancialExpense {
  if (!expense) throw new Error("expense was not found");
  return expense;
}

function auditFor(
  context: ReturnType<typeof assertExecutionContext>,
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

function mapRepositoryError(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23503"
  ) {
    throw new ConflictError();
  }
  throw error;
}

function contextFor(input: unknown) {
  return assertExecutionContext(input);
}

function method<T extends keyof ApplicationRepository>(
  repository: ApplicationRepository,
  name: T,
): NonNullable<ApplicationRepository[T]> {
  const candidate = repository[name];
  if (typeof candidate !== "function") {
    throw new Error(`repository method ${String(name)} is not configured`);
  }
  return candidate as NonNullable<ApplicationRepository[T]>;
}

export function createApplication(repository: ApplicationRepository) {
  return {
    async listBooks(contextInput: unknown): Promise<Book[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listBooks);
      return method(repository, "listBooks")(context.actorId, context.bookId);
    },

    async createAccount(input: CreateAccountCommand): Promise<Account> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createAccount);
      requireText(input.name, "name");
      requireText(input.type, "type");
      return method(repository, "createAccount")(
        { bookId: context.bookId, name: input.name, type: input.type },
        auditFor(context, "account.created", "account", {
          name: input.name,
          type: input.type,
        }),
      );
    },

    async listAccounts(contextInput: unknown): Promise<Account[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listAccounts);
      return method(repository, "listAccounts")(context.bookId);
    },

    async deleteAccount(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteAccount);
      requireText(input.id, "id");
      try {
        await method(repository, "deleteAccount")(
          context.bookId,
          input.id,
          auditFor(context, "account.deleted", "account", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createParty(input: CreatePartyCommand): Promise<Party> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createParty);
      requireText(input.name, "name");
      requireText(input.type, "type");
      return method(repository, "createParty")(
        { bookId: context.bookId, name: input.name, type: input.type },
        auditFor(context, "party.created", "party", {
          name: input.name,
          type: input.type,
        }),
      );
    },

    async listParties(contextInput: unknown): Promise<Party[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listParties);
      return method(repository, "listParties")(context.bookId);
    },

    async deleteParty(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteParty);
      requireText(input.id, "id");
      try {
        await method(repository, "deleteParty")(
          context.bookId,
          input.id,
          auditFor(context, "party.deleted", "party", { id: input.id }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createExpenseCategory(
      input: CreateCategoryCommand,
    ): Promise<ExpenseCategory> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpenseCategory);
      requireText(input.name, "name");
      return method(repository, "createExpenseCategory")(
        { bookId: context.bookId, name: input.name },
        auditFor(context, "expense_category.created", "expense_category", {
          name: input.name,
        }),
      );
    },

    async listExpenseCategories(
      contextInput: unknown,
    ): Promise<ExpenseCategory[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenseCategories);
      return method(repository, "listExpenseCategories")(context.bookId);
    },

    async deleteExpenseCategory(input: DeleteCommand): Promise<void> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.deleteExpenseCategory);
      requireText(input.id, "id");
      try {
        await method(repository, "deleteExpenseCategory")(
          context.bookId,
          input.id,
          auditFor(context, "expense_category.deleted", "expense_category", {
            id: input.id,
          }),
        );
      } catch (error) {
        mapRepositoryError(error);
      }
    },

    async createRevenueCategory(
      input: CreateCategoryCommand,
    ): Promise<RevenueCategory> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createRevenueCategory);
      requireText(input.name, "name");
      return method(repository, "createRevenueCategory")(
        { bookId: context.bookId, name: input.name },
        auditFor(context, "revenue_category.created", "revenue_category", {
          name: input.name,
        }),
      );
    },

    async listRevenueCategories(
      contextInput: unknown,
    ): Promise<RevenueCategory[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listRevenueCategories);
      return method(repository, "listRevenueCategories")(context.bookId);
    },

    async createExpense(input: CreateExpenseCommand): Promise<Expense> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.accountId, "accountId");
      requireText(input.partyId, "partyId");
      requireText(input.expenseCategoryId, "expenseCategoryId");
      if (input.amountMinor !== undefined || input.currency !== undefined) {
        requirePositiveMoney(input.amountMinor ?? 0n, input.currency ?? "");
      }
      if (
        input.installmentNumber !== undefined ||
        input.installmentCount !== undefined
      ) {
        const result = installment(
          input.installmentNumber ?? 0,
          input.installmentCount ?? 0,
        );
        if (!result.ok) throw result.error;
      }
      return method(repository, "createExpense")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          partyId: input.partyId,
          expenseCategoryId: input.expenseCategoryId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          installmentNumber: input.installmentNumber,
          installmentCount: input.installmentCount,
          occurredAt: input.occurredAt,
        },
        auditFor(context, "expense.created", "expense", {
          accountId: input.accountId,
          partyId: input.partyId,
          expenseCategoryId: input.expenseCategoryId,
        }),
      );
    },

    async listExpenses(contextInput: unknown): Promise<Expense[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listExpenses")(context.bookId);
    },

    async createPayment(input: CreatePaymentCommand): Promise<Payment> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.accountId, "accountId");
      if (input.partyId != null) requireText(input.partyId, "partyId");
      requirePositiveMoney(input.amountMinor, input.currency);
      return method(repository, "createPayment")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          partyId: input.partyId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          occurredAt: input.occurredAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "payment.created", "payment", {
          accountId: input.accountId,
          partyId: input.partyId,
          amountMinor: input.amountMinor,
          currency: input.currency,
        }),
      );
    },

    async listPayments(contextInput: unknown): Promise<Payment[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listPayments")(context.bookId);
    },

    async createExpenseSettlement(
      input: CreateExpenseSettlementCommand,
    ): Promise<ExpenseSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.expenseId, "expenseId");
      requireText(input.paymentId, "paymentId");
      requirePositiveMoney(input.amountMinor, input.currency);
      return method(repository, "createExpenseSettlement")(
        {
          bookId: context.bookId,
          expenseId: input.expenseId,
          paymentId: input.paymentId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "expense_settlement.created", "expense_settlement", {
          expenseId: input.expenseId,
          paymentId: input.paymentId,
          amountMinor: input.amountMinor,
          currency: input.currency,
        }),
      );
    },

    async voidExpenseSettlement(
      input: VoidExpenseSettlementCommand,
    ): Promise<ExpenseSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.id, "id");
      if (input.voidReason != null) requireText(input.voidReason, "voidReason");
      return method(repository, "voidExpenseSettlement")(
        {
          bookId: context.bookId,
          id: input.id,
          voidedBy: context.agentPrincipal ?? context.actorId,
          voidReason: input.voidReason,
        },
        auditFor(context, "expense_settlement.voided", "expense_settlement", {
          id: input.id,
          voidReason: input.voidReason,
        }),
      );
    },

    async getExpenseBalance(input: ExpenseQuery): Promise<Money> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      requireText(input.id, "id");
      const expense = requireExpense(
        await method(repository, "getExpense")(context.bookId, input.id),
      );
      const total = requirePositiveMoney(expense.amountMinor, expense.currency);
      const settlements = await method(repository, "listExpenseSettlements")(
        context.bookId,
        input.id,
      );
      const result = availableBalance(
        total,
        settlements.map((settlement) => ({
          amount: {
            minor: settlement.amountMinor,
            currency: settlement.currency,
          },
          voidedAt: settlement.voidedAt,
        })),
      );
      if (!result.ok) throw result.error;
      return result.value;
    },

    async getExpenseStatus(input: ExpenseQuery): Promise<FinancialStatus> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      requireText(input.id, "id");
      const expense = requireExpense(
        await method(repository, "getExpense")(context.bookId, input.id),
      );
      const total = requirePositiveMoney(expense.amountMinor, expense.currency);
      const settlements = await method(repository, "listExpenseSettlements")(
        context.bookId,
        input.id,
      );
      const result = financialStatus(
        total,
        settlements.map((settlement) => ({
          amount: {
            minor: settlement.amountMinor,
            currency: settlement.currency,
          },
          voidedAt: settlement.voidedAt,
        })),
      );
      if (!result.ok) throw result.error;
      return result.value;
    },

    async listExpenseSettlementHistory(
      input: ExpenseQuery,
    ): Promise<ExpenseSettlement[]> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      requireText(input.id, "id");
      return method(repository, "listExpenseSettlements")(
        context.bookId,
        input.id,
      );
    },

    async listPendingExpenses(
      contextInput: unknown,
    ): Promise<FinancialExpense[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listPendingExpenses")(context.bookId);
    },
  };
}

export type Application = ReturnType<typeof createApplication>;

export function createAccountCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreateAccountCommand) =>
      createApplication(repository).createAccount(input),
  };
}

export function createExpenseCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreateExpenseCommand) =>
      createApplication(repository).createExpense(input),
  };
}

export function createPaymentCommand(repository: ApplicationRepository) {
  return {
    execute: (input: CreatePaymentCommand) =>
      createApplication(repository).createPayment(input),
  };
}

export function createExpenseSettlementCommand(
  repository: ApplicationRepository,
) {
  return {
    execute: (input: CreateExpenseSettlementCommand) =>
      createApplication(repository).createExpenseSettlement(input),
  };
}

export function voidExpenseSettlementCommand(
  repository: ApplicationRepository,
) {
  return {
    execute: (input: VoidExpenseSettlementCommand) =>
      createApplication(repository).voidExpenseSettlement(input),
  };
}
