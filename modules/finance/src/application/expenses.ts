/** The expense cycle's use cases. */
import {
  type BoundOperation,
  type ExecutionContext,
  InvalidRequestError,
  type Scope,
  UnauthorizedError,
  bind,
  dateFromText,
} from "@lastro/kernel";
import * as contracts from "../contracts/expenses";
import {
  type FinancialCategory,
  type FinancialCategoryRole,
  isDeduction,
} from "../domain/catalog";
import {
  type Expense,
  type ExpenseSettlement,
  type Payment,
  type PaymentMethod,
  SignedItemError,
  assertInstallment,
  paymentDiscount,
  settlementPosition,
} from "../domain/records";
import type { CatalogPort, ExpensePort } from "./port";

type BookScope = Scope<ExecutionContext>;

const instant = (value: string | null | undefined) =>
  value == null ? null : new Date(value);
const day = (value: string | null | undefined) =>
  value == null ? null : dateFromText(value);

/* The discount expense recorded with a settlement is found by this key. */
const discountKey = (settlementId: string) => `discount-${settlementId}`;

export type ExpensesApi = {
  /**
   * The signed sum of the expenses whose competence month falls in
   * [from, to) and whose financial category has `role`, its own or its
   * group's. What a result report reads, such as a day's share of fixed costs.
   */
  totalByRole(
    scope: BookScope,
    query: { from: Date; to: Date; role: FinancialCategoryRole },
  ): Promise<Map<string, bigint>>;
};

export function createExpenses(port: CatalogPort & ExpensePort): {
  api: ExpensesApi;
  handlers: BoundOperation[];
} {
  const book = (scope: BookScope) => scope.context.bookId;

  async function financialCategoryOf(
    scope: BookScope,
    id: string,
    field: string,
  ) {
    const categories = await port.financialCategories.list(
      scope.handle,
      book(scope),
    );
    const category = categories.find((each) => each.id === id);
    if (!category)
      throw new InvalidRequestError(`${field} names no category of this Book`);
    return { category, deduction: isDeduction(id, categories) };
  }

  async function expenseOf(scope: BookScope, id: string): Promise<Expense> {
    const expense = await port.expenses.get(scope.handle, book(scope), id);
    if (!expense) throw new UnauthorizedError();
    return expense;
  }

  async function paymentOf(scope: BookScope, id: string): Promise<Payment> {
    const payment = await port.payments.get(scope.handle, book(scope), id);
    if (!payment) throw new UnauthorizedError();
    return payment;
  }

  /**
   * Settle a share of a positive expense into a payment, with the discount
   * obtained on it. The positive allocation lands first: the payment's amount
   * is recomputed after every row and may never go negative (ADR 6).
   */
  async function settle(
    scope: BookScope,
    input: {
      expense: Expense;
      payment: Payment;
      amount: bigint;
      installmentNumber: number;
      installmentCount: number;
      description: string | null;
      discount?: { amount: string; financialCategoryId: string };
    },
  ) {
    const { expense, payment } = input;
    if (expense.amount < 0n)
      throw new SignedItemError(
        "a deduction is settled with the expense it reduces, as its discount",
      );
    if (expense.currency !== payment.currency)
      throw new InvalidRequestError(
        `the expense is in ${expense.currency} and the payment in ${payment.currency}`,
      );
    assertInstallment(input.installmentNumber, input.installmentCount);

    let discount: { amount: bigint; category: FinancialCategory } | null = null;
    if (input.discount) {
      const { category, deduction } = await financialCategoryOf(
        scope,
        input.discount.financialCategoryId,
        "discount.financialCategoryId",
      );
      if (category.kind !== "EXPENSE" || !deduction)
        throw new SignedItemError(
          "a discount is booked under an EXPENSE category with the DEDUCTION role",
        );
      discount = {
        amount: paymentDiscount(input.amount, BigInt(input.discount.amount)),
        category,
      };
    }

    await port.lockSettlementSet(
      scope.handle,
      book(scope),
      expense.id,
      payment.id,
    );
    const existing = await port.expenseSettlements.list(
      scope.handle,
      book(scope),
      {
        expenseId: expense.id,
      },
    );
    const { outstanding } = settlementPosition(expense.amount, existing);
    if (input.amount > outstanding)
      throw new SignedItemError(
        `the share of ${input.amount} exceeds the ${outstanding} still open on the expense`,
      );

    const settlement = await port.expenseSettlements.insert(
      scope.handle,
      book(scope),
      {
        expenseId: expense.id,
        paymentId: payment.id,
        amount: input.amount,
        currency: expense.currency,
        installmentNumber: input.installmentNumber,
        installmentCount: input.installmentCount,
        description: input.description,
      },
    );
    scope.audit({
      action: "expense_settlement.created",
      resourceType: "expense_settlement",
      resourceId: settlement.id,
      payload: {
        expenseId: expense.id,
        paymentId: payment.id,
        amount: input.amount.toString(),
      },
    });

    let recorded: { expense: Expense; settlement: ExpenseSettlement } | null =
      null;
    if (discount) {
      const discountExpense = await port.expenses.insert(
        scope.handle,
        book(scope),
        {
          key: discountKey(settlement.id),
          partyId: expense.partyId,
          financialCategoryId: discount.category.id,
          name: `Discount on ${expense.name ?? expense.key}`,
          amount: discount.amount,
          currency: expense.currency,
          referenceMonth: expense.referenceMonth,
          occurredOn: payment.paidOn,
          occurredAt: payment.paidAt,
        },
      );
      const discountSettlement = await port.expenseSettlements.insert(
        scope.handle,
        book(scope),
        {
          expenseId: discountExpense.id,
          paymentId: payment.id,
          amount: discount.amount,
          currency: expense.currency,
          installmentNumber: 1,
          installmentCount: 1,
          description: `Discount on expense ${expense.id}`,
        },
      );
      const payload = {
        sourceExpenseId: expense.id,
        sourceSettlementId: settlement.id,
        paymentId: payment.id,
        amount: discount.amount.toString(),
      };
      scope.audit({
        action: "expense.created",
        resourceType: "expense",
        resourceId: discountExpense.id,
        payload,
      });
      scope.audit({
        action: "expense_settlement.created",
        resourceType: "expense_settlement",
        resourceId: discountSettlement.id,
        payload,
      });
      recorded = { expense: discountExpense, settlement: discountSettlement };
    }

    return {
      settlement,
      discount: recorded,
      payment: await paymentOf(scope, payment.id),
    };
  }

  const api: ExpensesApi = {
    async totalByRole(scope, query) {
      const [expenses, categories] = await Promise.all([
        port.expenses.listByReferenceMonth(
          scope.handle,
          book(scope),
          query.from,
          query.to,
        ),
        port.financialCategories.list(scope.handle, book(scope)),
      ]);
      const roleOf = (category: FinancialCategory | undefined) =>
        category?.role ??
        categories.find((each) => each.id === category?.parentId)?.role ??
        null;
      const totals = new Map<string, bigint>();
      for (const expense of expenses) {
        const category = categories.find(
          (each) => each.id === expense.financialCategoryId,
        );
        if (roleOf(category) !== query.role) continue;
        totals.set(
          expense.currency,
          (totals.get(expense.currency) ?? 0n) + expense.amount,
        );
      }
      return totals;
    },
  };

  return {
    api,
    handlers: [
      bind(contracts.createExpense, async ({ scope, input }) => {
        const { category, deduction } = await financialCategoryOf(
          scope,
          input.financialCategoryId,
          "financialCategoryId",
        );
        if (category.kind !== "EXPENSE")
          throw new InvalidRequestError(
            "financialCategoryId must be an EXPENSE category",
          );
        // A negative expense is only ever a discount, recorded while paying.
        if (deduction)
          throw new SignedItemError(
            "a DEDUCTION category holds discounts, recorded through settle_expense or pay_expense",
          );
        if (!(await port.parties.get(scope.handle, book(scope), input.partyId)))
          throw new InvalidRequestError("partyId names no party of this Book");
        const expense = await port.expenses.insert(scope.handle, book(scope), {
          key: input.key,
          partyId: input.partyId,
          financialCategoryId: input.financialCategoryId,
          name: input.name ?? null,
          amount: BigInt(input.amount),
          currency: input.currency,
          referenceMonth: dateFromText(input.referenceMonth),
          occurredOn: day(input.occurredOn),
          occurredAt: instant(input.occurredAt),
        });
        scope.audit({
          action: "expense.created",
          resourceType: "expense",
          resourceId: expense.id,
          payload: { ...input },
        });
        return expense;
      }),

      bind(contracts.listExpenses, async ({ scope, input }) => {
        const items = await port.expenses.list(scope.handle, book(scope), {
          after: input.cursor,
          limit: input.limit,
          referenceMonth: input.referenceMonth
            ? dateFromText(input.referenceMonth)
            : undefined,
        });
        return {
          items,
          nextCursor:
            items.length === input.limit ? (items.at(-1)?.id ?? null) : null,
        };
      }),

      bind(contracts.getExpense, async ({ scope, input }) => {
        const expense = await expenseOf(scope, input.id);
        const settlements = await port.expenseSettlements.list(
          scope.handle,
          book(scope),
          {
            expenseId: expense.id,
          },
        );
        return {
          expense,
          settlements,
          ...settlementPosition(expense.amount, settlements),
        };
      }),

      bind(contracts.listOpenExpenses, async ({ scope }) => {
        const [expenses, settlements] = await Promise.all([
          port.expenses.listPositive(scope.handle, book(scope)),
          port.expenseSettlements.list(scope.handle, book(scope), {}),
        ]);
        const byExpense = new Map<string, ExpenseSettlement[]>();
        for (const each of settlements)
          byExpense.set(each.expenseId, [
            ...(byExpense.get(each.expenseId) ?? []),
            each,
          ]);
        const items = expenses
          .map((expense) => ({
            expense,
            ...settlementPosition(
              expense.amount,
              byExpense.get(expense.id) ?? [],
            ),
          }))
          .filter((item) => item.outstanding > 0n);
        const totals = new Map<
          string,
          { outstanding: bigint; count: number }
        >();
        for (const item of items) {
          const total = totals.get(item.expense.currency) ?? {
            outstanding: 0n,
            count: 0,
          };
          total.outstanding += item.outstanding;
          total.count += 1;
          totals.set(item.expense.currency, total);
        }
        return {
          items,
          totals: [...totals].map(([currency, total]) => ({
            currency,
            ...total,
          })),
        };
      }),

      bind(contracts.createPayment, async ({ scope, input }) => {
        const payment = await port.payments.insert(scope.handle, book(scope), {
          accountId: input.accountId,
          key: input.key ?? null,
          method: (input.method ?? null) as PaymentMethod | null,
          currency: input.currency,
          referenceMonth: dateFromText(input.referenceMonth),
          dueOn: day(input.dueOn),
          dueAt: instant(input.dueAt),
          paidOn: day(input.paidOn),
          paidAt: instant(input.paidAt),
        });
        scope.audit({
          action: "payment.created",
          resourceType: "payment",
          resourceId: payment.id,
          payload: { ...input },
        });
        return payment;
      }),

      bind(contracts.listPayments, async ({ scope, input }) => {
        const items = await port.payments.list(scope.handle, book(scope), {
          after: input.cursor,
          limit: input.limit,
          accountId: input.accountId,
        });
        return {
          items,
          nextCursor:
            items.length === input.limit ? (items.at(-1)?.id ?? null) : null,
        };
      }),

      bind(contracts.getPayment, async ({ scope, input }) => {
        const payment = await paymentOf(scope, input.id);
        return {
          payment,
          settlements: await port.expenseSettlements.list(
            scope.handle,
            book(scope),
            {
              paymentId: payment.id,
            },
          ),
        };
      }),

      bind(contracts.settleExpense, async ({ scope, input }) =>
        settle(scope, {
          expense: await expenseOf(scope, input.expenseId),
          payment: await paymentOf(scope, input.paymentId),
          amount: BigInt(input.amount),
          installmentNumber: input.installmentNumber,
          installmentCount: input.installmentCount,
          description: input.description ?? null,
          discount: input.discount,
        }),
      ),

      bind(contracts.payExpense, async ({ scope, input }) => {
        const expense = await expenseOf(scope, input.expenseId);
        const payment = await port.payments.insert(scope.handle, book(scope), {
          accountId: input.accountId,
          key: null,
          method: (input.method ?? null) as PaymentMethod | null,
          currency: expense.currency,
          referenceMonth: expense.referenceMonth,
          dueOn: day(input.paidOn),
          dueAt: instant(input.paidAt),
          paidOn: day(input.paidOn),
          paidAt: instant(input.paidAt),
        });
        scope.audit({
          action: "payment.created",
          resourceType: "payment",
          resourceId: payment.id,
          payload: { expenseId: expense.id, accountId: input.accountId },
        });
        return settle(scope, {
          expense,
          payment,
          amount: BigInt(input.amount),
          installmentNumber: 1,
          installmentCount: 1,
          description: null,
          discount: input.discount,
        });
      }),

      bind(contracts.voidExpenseSettlement, async ({ scope, input }) => {
        const target = await port.expenseSettlements.get(
          scope.handle,
          book(scope),
          input.id,
        );
        if (!target || target.voidedAt) throw new UnauthorizedError();
        const by = {
          voidedBy: scope.context.agentPrincipal ?? scope.context.actorId,
          voidReason: input.voidReason ?? null,
        };
        await port.lockSettlementSet(
          scope.handle,
          book(scope),
          target.expenseId,
          target.paymentId,
        );

        // The discount goes first, or the payment would briefly go negative.
        let voidedDiscount: ExpenseSettlement | null = null;
        const discount = await port.expenses.getByKey(
          scope.handle,
          book(scope),
          discountKey(target.id),
        );
        if (discount) {
          const [active] = (
            await port.expenseSettlements.list(scope.handle, book(scope), {
              expenseId: discount.id,
            })
          ).filter((each) => !each.voidedAt);
          if (active) {
            voidedDiscount = await port.expenseSettlements.void(
              scope.handle,
              book(scope),
              active.id,
              by,
            );
            scope.audit({
              action: "expense_settlement.voided",
              resourceType: "expense_settlement",
              resourceId: active.id,
              payload: { ...by, with: target.id },
            });
          }
        }

        const settlement = await port.expenseSettlements.void(
          scope.handle,
          book(scope),
          target.id,
          by,
        );
        if (!settlement) throw new UnauthorizedError();
        scope.audit({
          action: "expense_settlement.voided",
          resourceType: "expense_settlement",
          resourceId: settlement.id,
          payload: { ...by },
        });
        return { settlement, voidedDiscount };
      }),
    ],
  };
}
