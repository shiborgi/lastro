/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApplication } from "./index";

const baseContext = {
  actorId: "user-1",
  bookId: "1",
  role: "EDITOR" as const,
  source: "API" as const,
  correlationId: "correlation-1",
};

function fakeRepository() {
  let mutations = 0;
  return {
    get mutations() {
      return mutations;
    },
    createAccount: async () => {
      mutations += 1;
      return { id: "account-1", bookId: "1", name: "Cash", type: "CASH" };
    },
    listAccounts: async (bookId: string) => [
      { id: "account-1", bookId, name: "Cash", type: "CASH" },
    ],
  };
}

function financialRepository() {
  const calls: Array<{
    bookId: string;
    accountId: string;
    partyId?: string | null;
    amountMinor: bigint;
    currency: string;
    occurredAt?: Date;
    idempotencyKey?: string;
  }> = [];
  return {
    calls,
    createPayment: async (input: {
      bookId: string;
      accountId: string;
      partyId?: string | null;
      amountMinor: bigint;
      currency: string;
      idempotencyKey?: string;
    }) => {
      calls.push(input);
      return { id: "payment-1", ...input };
    },
    getExpense: async (bookId: string, id: string) => ({
      id,
      bookId,
      name: "Supplies",
      type: "EXPENSE",
      accountId: "account-1",
      partyId: "party-1",
      expenseCategoryId: "category-1",
      amountMinor: 100n,
      currency: "USD",
    }),
    listExpenseSettlements: async () => [
      {
        id: "settlement-1",
        bookId: "1",
        expenseId: "expense-1",
        paymentId: "payment-1",
        amountMinor: 40n,
        currency: "USD",
      },
      {
        id: "settlement-2",
        bookId: "1",
        expenseId: "expense-1",
        paymentId: "payment-2",
        amountMinor: 20n,
        currency: "USD",
        voidedAt: new Date(),
      },
    ],
  };
}

describe("financial application commands", () => {
  test("validate context before repository mutation", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);

    await expect(
      application.createAccount({
        context: { ...baseContext, correlationId: "" },
        name: "Cash",
        type: "CASH",
      }),
    ).rejects.toThrow(/correlationId/);
    expect(repository.mutations).toBe(0);
  });

  test("returns only records for the selected Book", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);
    const records = await application.listAccounts({
      ...baseContext,
      bookId: "2",
    });
    expect(records).toEqual([
      { id: "account-1", bookId: "2", name: "Cash", type: "CASH" },
    ]);
  });

  test("forbidden mutations do not reach the repository", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);
    await expect(
      application.createAccount({
        context: { ...baseContext, role: "VIEWER" },
        name: "Cash",
        type: "CASH",
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(repository.mutations).toBe(0);
  });

  test("scopes payments and their idempotency keys to the execution Book", async () => {
    const repository = financialRepository();
    const application = createApplication(repository);

    await application.createPayment({
      context: { ...baseContext, bookId: "2", idempotencyKey: "payment-key" },
      accountId: "account-1",
      amountMinor: 100n,
      currency: "USD",
    });

    expect(repository.calls).toEqual([
      {
        bookId: "2",
        accountId: "account-1",
        amountMinor: 100n,
        currency: "USD",
        idempotencyKey: "payment-key",
        partyId: undefined,
        occurredAt: undefined,
      },
    ]);
  });

  test("calculates status and balance without voided settlements", async () => {
    const application = createApplication(financialRepository());
    const input = { context: baseContext, id: "expense-1" };

    expect(await application.getExpenseBalance(input)).toEqual({
      minor: 60n,
      currency: "USD",
    });
    expect(await application.getExpenseStatus(input)).toBe("PARTIALLY_SETTLED");
  });

  test("persists monetary installment details when creating an expense", async () => {
    let created: Record<string, unknown> | undefined;
    const application = createApplication({
      createExpense: async (input) => {
        created = input;
        return { id: "expense-1", ...input };
      },
    });

    await application.createExpense({
      context: baseContext,
      accountId: "account-1",
      partyId: "party-1",
      expenseCategoryId: "category-1",
      amountMinor: 300n,
      currency: "USD",
      installmentNumber: 1,
      installmentCount: 3,
    });

    expect(created).toMatchObject({
      amountMinor: 300n,
      currency: "USD",
      installmentNumber: 1,
      installmentCount: 3,
    });
  });
});
