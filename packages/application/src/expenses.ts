import {
  ConflictError,
  type Expense,
  type ExpenseSettlement,
  type FinancialStatus,
  type Money,
  type Payment,
  assertAuthorized,
  availableBalance,
  financialStatus,
  installment,
  operations,
} from "@lastro/domain";
import {
  auditFor,
  contextFor,
  method,
  page,
  requirePositiveMoney,
  requireText,
} from "./helpers";
import type {
  ApplicationRepository,
  CreateExpenseCommand,
  CreateExpenseSettlementCommand,
  CreatePaymentCommand,
  ExpenseQuery,
  FinancialExpense,
  PageQuery,
  Page as PageType,
  VoidExpenseSettlementCommand,
} from "./types";

function requireExpense(expense: FinancialExpense | null): FinancialExpense {
  if (!expense) throw new Error("expense was not found");
  return expense;
}

export function createExpenseMethods(repository: ApplicationRepository) {
  return {
    async createExpense(input: CreateExpenseCommand): Promise<Expense> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.createExpense);
      requireText(input.key, "key");
      requireText(input.partyId, "partyId");
      requireText(input.categoryId, "categoryId");
      if (input.amount !== undefined || input.currency !== undefined) {
        requirePositiveMoney(input.amount ?? 0n, input.currency ?? "");
      }
      return method(repository, "createExpense")(
        {
          bookId: context.bookId,
          key: input.key,
          referenceMonth: input.referenceMonth,
          partyId: input.partyId,
          categoryId: input.categoryId,
          amount: input.amount,
          currency: input.currency,
          occurredAt: input.occurredAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "expense.created", "expense", {
          key: input.key,
          referenceMonth: input.referenceMonth.toISOString(),
          partyId: input.partyId,
          categoryId: input.categoryId,
        }),
      );
    },

    async listExpenses(contextInput: unknown): Promise<Expense[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listExpenses")(context.bookId);
    },

    async listExpensesPage(input: PageQuery): Promise<PageType<Expense>> {
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
      requireText(input.currency, "currency");
      if (
        !(input.dueAt instanceof Date) ||
        Number.isNaN(input.dueAt.valueOf())
      ) {
        throw new ConflictError();
      }
      return method(repository, "createPayment")(
        {
          bookId: context.bookId,
          accountId: input.accountId,
          referenceMonth: input.referenceMonth,
          currency: input.currency,
          dueAt: input.dueAt,
          paidAt: input.paidAt,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "payment.created", "payment", {
          accountId: input.accountId,
          referenceMonth: input.referenceMonth.toISOString(),
          currency: input.currency,
          dueAt: input.dueAt.toISOString(),
        }),
      );
    },

    async listPayments(contextInput: unknown): Promise<Payment[]> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listExpenses);
      return method(repository, "listPayments")(context.bookId);
    },

    async listPaymentsPage(input: PageQuery): Promise<PageType<Payment>> {
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
      requirePositiveMoney(input.amount, input.currency);
      const installmentResult = installment(
        input.installmentNumber,
        input.installmentCount,
      );
      if (!installmentResult.ok) throw installmentResult.error;
      return method(repository, "createExpenseSettlement")(
        {
          bookId: context.bookId,
          expenseId: input.expenseId,
          paymentId: input.paymentId,
          amount: input.amount,
          currency: input.currency,
          installmentNumber: input.installmentNumber,
          installmentCount: input.installmentCount,
          idempotencyKey: context.idempotencyKey,
        },
        auditFor(context, "expense_settlement.created", "expense_settlement", {
          expenseId: input.expenseId,
          paymentId: input.paymentId,
          amount: input.amount.toString(),
          currency: input.currency,
          installmentNumber: input.installmentNumber,
          installmentCount: input.installmentCount,
        }),
      );
    },

    async voidExpenseSettlement(
      input: VoidExpenseSettlementCommand,
    ): Promise<ExpenseSettlement> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.voidExpenseSettlement);
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
      const total = requirePositiveMoney(expense.amount, expense.currency);
      const settlements = await method(repository, "listExpenseSettlements")(
        context.bookId,
        input.id,
      );
      const result = availableBalance(
        total,
        settlements.map((settlement) => ({
          amount: {
            amount: settlement.amount,
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
      const total = requirePositiveMoney(expense.amount, expense.currency);
      const settlements = await method(repository, "listExpenseSettlements")(
        context.bookId,
        input.id,
      );
      const result = financialStatus(
        total,
        settlements.map((settlement) => ({
          amount: {
            amount: settlement.amount,
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
    ): Promise<PageType<ExpenseSettlement>> {
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
      expenses: PageType<{
        expense: FinancialExpense;
        outstanding: bigint;
        status: FinancialStatus;
      }>;
      totals: { currency: string; outstanding: bigint; count: number }[];
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
            outstanding: (
              await this.getExpenseBalance({ context, id: String(expense.id) })
            ).amount,
            status: await this.getExpenseStatus({
              context,
              id: String(expense.id),
            }),
          })),
        )
      ).filter((item) => item.outstanding > 0n);
      const totals = new Map<string, { outstanding: bigint; count: number }>();
      for (const item of positioned) {
        const current = totals.get(item.expense.currency) ?? {
          outstanding: 0n,
          count: 0,
        };
        current.outstanding += item.outstanding;
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
  };
}
