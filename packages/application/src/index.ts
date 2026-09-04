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
  type Receipt,
  type Revenue,
  type RevenueCategory,
  type RevenueSettlement,
  type Transfer,
  assertAuthorized,
  assertExecutionContext,
  availableBalance,
  financialStatus,
  installment,
  money,
  operations,
  validateTransferPair,
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

export type FinancialRevenue = Revenue & {
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
    input: Omit<Expense, "id"> & { idempotencyKey?: string },
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
    expenseId?: string,
  ) => Promise<ExpenseSettlement[]>;
  listPendingExpenses?: (bookId: string) => Promise<FinancialExpense[]>;
  createRevenue?: (
    input: {
      bookId: string;
      accountId: string;
      partyId: string;
      revenueCategoryId: string;
      amountMinor: bigint;
      currency: string;
      occurredAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Revenue>;
  listRevenues?: (bookId: string) => Promise<Revenue[]>;
  getRevenue?: (bookId: string, id: string) => Promise<FinancialRevenue | null>;
  createReceipt?: (
    input: {
      bookId: string;
      accountId: string;
      partyId?: string | null;
      amountMinor: bigint;
      currency: string;
      occurredAt?: Date;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Receipt>;
  listReceipts?: (bookId: string) => Promise<Receipt[]>;
  createRevenueSettlement?: (
    input: {
      bookId: string;
      revenueId: string;
      receiptId: string;
      amountMinor: bigint;
      currency: string;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<RevenueSettlement>;
  voidRevenueSettlement?: (
    input: {
      bookId: string;
      id: string;
      voidedBy: string;
      voidReason?: string;
    },
    audit: AuditEvent,
  ) => Promise<RevenueSettlement>;
  listRevenueSettlements?: (
    bookId: string,
    revenueId?: string,
  ) => Promise<RevenueSettlement[]>;
  listPendingRevenues?: (bookId: string) => Promise<FinancialRevenue[]>;
  createTransfer?: (
    input: {
      bookId: string;
      sourceAccountId: string;
      destinationAccountId: string;
      amountMinor: bigint;
      currency: string;
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<Transfer>;
  listTransfers?: (bookId: string) => Promise<Transfer[]>;
  getTransferByCorrelation?: (
    correlationId: string,
  ) => Promise<Transfer | null>;
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

export type CreateRevenueCommand = CommandContext & {
  accountId: string;
  partyId: string;
  revenueCategoryId: string;
  amountMinor: bigint;
  currency: string;
  occurredAt?: Date;
};

export type CreateReceiptCommand = CommandContext & {
  accountId: string;
  partyId?: string | null;
  amountMinor: bigint;
  currency: string;
  occurredAt?: Date;
};

export type CreateRevenueSettlementCommand = CommandContext & {
  revenueId: string;
  receiptId: string;
  amountMinor: bigint;
  currency: string;
};

export type VoidRevenueSettlementCommand = CommandContext & {
  id: string;
  voidReason?: string;
};

export type CreateTransferCommand = CommandContext & {
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: bigint;
  currency: string;
};

export type ExpenseQuery = CommandContext & { id: string };
export type PageQuery = CommandContext & { cursor?: string; limit: number };
export type Page<T> = { items: T[]; nextCursor: string | null };

function page<T extends { id: string | number }>(
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

function requireRevenue(revenue: FinancialRevenue | null): FinancialRevenue {
  if (!revenue) throw new Error("revenue was not found");
  return revenue;
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
          idempotencyKey: context.idempotencyKey,
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

    async listExpensesPage(input: PageQuery): Promise<Page<Expense>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      return page(
        await method(repository, "listExpenses")(context.bookId),
        input.cursor,
        input.limit,
      );
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
          amountMinor: input.amountMinor.toString(),
          currency: input.currency,
        }),
      );
    },

    async listPayments(contextInput: unknown): Promise<Payment[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listPayments")(context.bookId);
    },

    async listPaymentsPage(input: PageQuery): Promise<Page<Payment>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      return page(
        await method(repository, "listPayments")(context.bookId),
        input.cursor,
        input.limit,
      );
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
          amountMinor: input.amountMinor.toString(),
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

    async listExpenseSettlementsPage(
      input: PageQuery,
    ): Promise<Page<ExpenseSettlement>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      return page(
        await method(repository, "listExpenseSettlements")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async listPendingExpenses(
      contextInput: unknown,
    ): Promise<FinancialExpense[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listPendingExpenses")(context.bookId);
    },

    async getBookPosition(input: PageQuery): Promise<{
      expenses: Page<{
        expense: FinancialExpense;
        outstandingMinor: bigint;
        status: FinancialStatus;
      }>;
      totals: { currency: string; outstandingMinor: bigint; count: number }[];
    }> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listExpenses);
      const expenses = await method(
        repository,
        "listPendingExpenses",
      )(context.bookId);
      const positioned = (
        await Promise.all(
          expenses.map(async (expense) => ({
            expense,
            outstandingMinor: (
              await this.getExpenseBalance({ context, id: String(expense.id) })
            ).minor,
            status: await this.getExpenseStatus({
              context,
              id: String(expense.id),
            }),
          })),
        )
      ).filter((item) => item.outstandingMinor > 0n);
      const totals = new Map<
        string,
        { outstandingMinor: bigint; count: number }
      >();
      for (const item of positioned) {
        const current = totals.get(item.expense.currency) ?? {
          outstandingMinor: 0n,
          count: 0,
        };
        current.outstandingMinor += item.outstandingMinor;
        current.count += 1;
        totals.set(item.expense.currency, current);
      }
      const expensePage = page(
        positioned.map((item) => ({ ...item, id: item.expense.id })),
        input.cursor,
        input.limit,
      );
      return {
        expenses: {
          items: expensePage.items.map(({ id: _id, ...item }) => item),
          nextCursor: expensePage.nextCursor,
        },
        totals: [...totals].map(([currency, total]) => ({
          currency,
          ...total,
        })),
      };
    },

    async createRevenue(input: CreateRevenueCommand): Promise<Revenue> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createRevenue);
      requireText(input.accountId, "accountId");
      requireText(input.partyId, "partyId");
      requireText(input.revenueCategoryId, "revenueCategoryId");
      requirePositiveMoney(input.amountMinor, input.currency);
      return method(repository, "createRevenue")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          partyId: input.partyId,
          revenueCategoryId: input.revenueCategoryId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          occurredAt: input.occurredAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "revenue.created", "revenue", {
          accountId: input.accountId,
          partyId: input.partyId,
          revenueCategoryId: input.revenueCategoryId,
        }),
      );
    },

    async listRevenues(contextInput: unknown): Promise<Revenue[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listRevenues);
      return method(repository, "listRevenues")(context.bookId);
    },

    async listRevenuesPage(input: PageQuery): Promise<Page<Revenue>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      return page(
        await method(repository, "listRevenues")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async createReceipt(input: CreateReceiptCommand): Promise<Receipt> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createReceipt);
      requireText(input.accountId, "accountId");
      if (input.partyId != null) requireText(input.partyId, "partyId");
      requirePositiveMoney(input.amountMinor, input.currency);
      return method(repository, "createReceipt")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          partyId: input.partyId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          occurredAt: input.occurredAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "receipt.created", "receipt", {
          accountId: input.accountId,
          partyId: input.partyId,
          amountMinor: input.amountMinor.toString(),
          currency: input.currency,
        }),
      );
    },

    async listReceipts(contextInput: unknown): Promise<Receipt[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listReceipts);
      return method(repository, "listReceipts")(context.bookId);
    },

    async listReceiptsPage(input: PageQuery): Promise<Page<Receipt>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listReceipts);
      return page(
        await method(repository, "listReceipts")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async createRevenueSettlement(
      input: CreateRevenueSettlementCommand,
    ): Promise<RevenueSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createRevenueSettlement);
      requireText(input.revenueId, "revenueId");
      requireText(input.receiptId, "receiptId");
      requirePositiveMoney(input.amountMinor, input.currency);
      return method(repository, "createRevenueSettlement")(
        {
          bookId: context.bookId,
          revenueId: input.revenueId,
          receiptId: input.receiptId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "revenue_settlement.created", "revenue_settlement", {
          revenueId: input.revenueId,
          receiptId: input.receiptId,
          amountMinor: input.amountMinor.toString(),
          currency: input.currency,
        }),
      );
    },

    async voidRevenueSettlement(
      input: VoidRevenueSettlementCommand,
    ): Promise<RevenueSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.voidRevenueSettlement);
      requireText(input.id, "id");
      if (input.voidReason != null) requireText(input.voidReason, "voidReason");
      return method(repository, "voidRevenueSettlement")(
        {
          bookId: context.bookId,
          id: input.id,
          voidedBy: context.agentPrincipal ?? context.actorId,
          voidReason: input.voidReason,
        },
        auditFor(context, "revenue_settlement.voided", "revenue_settlement", {
          id: input.id,
          voidReason: input.voidReason,
        }),
      );
    },

    async getRevenueBalance(input: ExpenseQuery): Promise<Money> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      requireText(input.id, "id");
      const revenue = requireRevenue(
        await method(repository, "getRevenue")(context.bookId, input.id),
      );
      const total = requirePositiveMoney(revenue.amountMinor, revenue.currency);
      const settlements = await method(repository, "listRevenueSettlements")(
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

    async getRevenueStatus(input: ExpenseQuery): Promise<FinancialStatus> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      requireText(input.id, "id");
      const revenue = requireRevenue(
        await method(repository, "getRevenue")(context.bookId, input.id),
      );
      const total = requirePositiveMoney(revenue.amountMinor, revenue.currency);
      const settlements = await method(repository, "listRevenueSettlements")(
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

    async listRevenueSettlementHistory(
      input: ExpenseQuery,
    ): Promise<RevenueSettlement[]> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenueSettlements);
      requireText(input.id, "id");
      return method(repository, "listRevenueSettlements")(
        context.bookId,
        input.id,
      );
    },

    async listRevenueSettlementsPage(
      input: PageQuery,
    ): Promise<Page<RevenueSettlement>> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenueSettlements);
      return page(
        await method(repository, "listRevenueSettlements")(context.bookId),
        input.cursor,
        input.limit,
      );
    },

    async listPendingRevenues(
      contextInput: unknown,
    ): Promise<FinancialRevenue[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listRevenues);
      return method(repository, "listPendingRevenues")(context.bookId);
    },

    async getRevenuePosition(input: PageQuery): Promise<{
      revenues: Page<{
        revenue: FinancialRevenue;
        outstandingMinor: bigint;
        status: FinancialStatus;
      }>;
      totals: { currency: string; outstandingMinor: bigint; count: number }[];
    }> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.listRevenues);
      const revenues = await method(
        repository,
        "listPendingRevenues",
      )(context.bookId);
      const positioned = (
        await Promise.all(
          revenues.map(async (revenue) => ({
            revenue,
            outstandingMinor: (
              await this.getRevenueBalance({ context, id: String(revenue.id) })
            ).minor,
            status: await this.getRevenueStatus({
              context,
              id: String(revenue.id),
            }),
          })),
        )
      ).filter((item) => item.outstandingMinor > 0n);
      const totals = new Map<
        string,
        { outstandingMinor: bigint; count: number }
      >();
      for (const item of positioned) {
        const current = totals.get(item.revenue.currency) ?? {
          outstandingMinor: 0n,
          count: 0,
        };
        current.outstandingMinor += item.outstandingMinor;
        current.count += 1;
        totals.set(item.revenue.currency, current);
      }
      const revenuePage = page(
        positioned.map((item) => ({ ...item, id: item.revenue.id })),
        input.cursor,
        input.limit,
      );
      return {
        revenues: {
          items: revenuePage.items.map(({ id: _id, ...item }) => item),
          nextCursor: revenuePage.nextCursor,
        },
        totals: [...totals].map(([currency, total]) => ({
          currency,
          ...total,
        })),
      };
    },

    async createTransfer(input: CreateTransferCommand): Promise<Transfer> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createTransfer);
      const pair = validateTransferPair({
        bookId: context.bookId,
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
      if (!pair.ok) throw pair.error;
      return method(repository, "createTransfer")(
        {
          bookId: context.bookId,
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "transfer.created", "transfer", {
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amountMinor: input.amountMinor.toString(),
          currency: input.currency,
        }),
      );
    },

    async listTransfers(contextInput: unknown): Promise<Transfer[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.createTransfer);
      return method(repository, "listTransfers")(context.bookId);
    },

    async getTransferByCorrelation(
      correlationId: string,
    ): Promise<Transfer | null> {
      return method(repository, "getTransferByCorrelation")(correlationId);
    },

    async getCashFlow(contextInput: unknown): Promise<{
      inflows: { currency: string; amountMinor: bigint; count: number }[];
      outflows: { currency: string; amountMinor: bigint; count: number }[];
      transfers: { currency: string; amountMinor: bigint; count: number }[];
    }> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listReceipts);
      const [receipts, payments, transfers] = await Promise.all([
        method(repository, "listReceipts")(context.bookId),
        method(repository, "listPayments")(context.bookId),
        method(repository, "listTransfers")(context.bookId),
      ]);
      const inflows = new Map<string, { amountMinor: bigint; count: number }>();
      for (const receipt of receipts) {
        const current = inflows.get(receipt.currency) ?? {
          amountMinor: 0n,
          count: 0,
        };
        current.amountMinor += receipt.amountMinor;
        current.count += 1;
        inflows.set(receipt.currency, current);
      }
      const outflows = new Map<
        string,
        { amountMinor: bigint; count: number }
      >();
      for (const payment of payments) {
        const current = outflows.get(payment.currency) ?? {
          amountMinor: 0n,
          count: 0,
        };
        current.amountMinor += payment.amountMinor;
        current.count += 1;
        outflows.set(payment.currency, current);
      }
      const transfersAgg = new Map<
        string,
        { amountMinor: bigint; count: number }
      >();
      for (const transfer of transfers) {
        const current = transfersAgg.get(transfer.currency) ?? {
          amountMinor: 0n,
          count: 0,
        };
        current.amountMinor += transfer.amountMinor;
        current.count += 1;
        transfersAgg.set(transfer.currency, current);
      }
      return {
        inflows: [...inflows].map(([currency, value]) => ({
          currency,
          ...value,
        })),
        outflows: [...outflows].map(([currency, value]) => ({
          currency,
          ...value,
        })),
        transfers: [...transfersAgg].map(([currency, value]) => ({
          currency,
          ...value,
        })),
      };
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
