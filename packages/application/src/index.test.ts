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
      return {
        id: "account-1",
        bookId: "1",
        key: "cash",
        name: "Cash",
        type: "CASH",
      };
    },
    listAccounts: async (bookId: string) => [
      { id: "account-1", bookId, key: "cash", name: "Cash", type: "CASH" },
    ],
  };
}

function financialRepository() {
  const calls: Array<{
    bookId: string;
    accountId: string;
    referenceMonth: Date;
    currency: string;
    dueAt: Date;
    paidAt?: Date;
    idempotencyKey?: string;
  }> = [];
  return {
    calls,
    createPayment: async (input: {
      bookId: string;
      accountId: string;
      referenceMonth: Date;
      currency: string;
      dueAt: Date;
      paidAt?: Date;
      idempotencyKey?: string;
    }) => {
      calls.push(input);
      return { id: "payment-1", amount: 0n, ...input };
    },
    getExpense: async (bookId: string, id: string) => ({
      id,
      bookId,
      name: "Supplies",
      type: "EXPENSE",
      key: "exp-1",
      referenceMonth: new Date("2026-09-01T00:00:00Z"),
      partyId: "party-1",
      categoryId: "category-1",
      amount: 100n,
      currency: "USD",
    }),
    listExpenseSettlements: async () => [
      {
        id: "settlement-1",
        bookId: "1",
        expenseId: "expense-1",
        paymentId: "payment-1",
        amount: 40n,
        currency: "USD",
        installmentNumber: 1,
        installmentCount: 3,
      },
      {
        id: "settlement-2",
        bookId: "1",
        expenseId: "expense-1",
        paymentId: "payment-2",
        amount: 20n,
        currency: "USD",
        installmentNumber: 1,
        installmentCount: 3,
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
        key: "cash",
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
      { id: "account-1", bookId: "2", key: "cash", name: "Cash", type: "CASH" },
    ]);
  });

  test("forbidden mutations do not reach the repository", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);
    await expect(
      application.createAccount({
        context: { ...baseContext, role: "VIEWER" },
        key: "cash",
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
      referenceMonth: new Date("2026-09-01T00:00:00Z"),
      currency: "USD",
      dueAt: new Date("2026-10-10T00:00:00Z"),
    });

    expect(repository.calls).toEqual([
      {
        bookId: "2",
        accountId: "account-1",
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        currency: "USD",
        dueAt: new Date("2026-10-10T00:00:00Z"),
        idempotencyKey: "payment-key",
        paidAt: undefined,
      },
    ]);
  });

  test("calculates status and balance without voided settlements", async () => {
    const application = createApplication(financialRepository());
    const input = { context: baseContext, id: "expense-1" };

    expect(await application.getExpenseBalance(input)).toEqual({
      amount: 60n,
      currency: "USD",
    });
    expect(await application.getExpenseStatus(input)).toBe("PARTIALLY_SETTLED");
  });

  test("persists installment details on a settlement", async () => {
    let created: Record<string, unknown> | undefined;
    const application = createApplication({
      createExpenseSettlement: async (input) => {
        created = input;
        return { id: "settlement-1", ...input };
      },
    });

    await application.createExpenseSettlement({
      context: baseContext,
      expenseId: "expense-1",
      paymentId: "payment-1",
      amount: 300n,
      currency: "USD",
      installmentNumber: 1,
      installmentCount: 3,
    });

    expect(created).toMatchObject({
      amount: 300n,
      currency: "USD",
      installmentNumber: 1,
      installmentCount: 3,
    });
  });

  test("creates a revenue scoped to the execution Book with idempotency", async () => {
    let created: Record<string, unknown> | undefined;
    const application = createApplication({
      createRevenue: async (input) => {
        created = input;
        return { id: "revenue-1", ...input };
      },
    });

    await application.createRevenue({
      context: { ...baseContext, bookId: "2", idempotencyKey: "revenue-key" },
      key: "rev-1",
      referenceMonth: new Date("2026-09-01T00:00:00Z"),
      partyId: "party-1",
      categoryId: "category-1",
      amount: 200n,
      currency: "USD",
    });

    expect(created).toMatchObject({
      bookId: "2",
      key: "rev-1",
      referenceMonth: new Date("2026-09-01T00:00:00Z"),
      partyId: "party-1",
      categoryId: "category-1",
      amount: 200n,
      currency: "USD",
      idempotencyKey: "revenue-key",
    });
  });

  test("creates a transfer only when the pair shares a Book and currency", async () => {
    let created: Record<string, unknown> | undefined;
    const application = createApplication({
      createTransfer: async (input) => {
        created = input;
        return {
          id: "transfer-1",
          correlationId: "correlation-1",
          ...input,
        };
      },
    });

    await expect(
      application.createTransfer({
        context: baseContext,
        key: "t-1",
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        sourceAccountId: "account-1",
        destinationAccountId: "account-1",
        amount: 50n,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSFER" });
    expect(created).toBeUndefined();

    const transfer = await application.createTransfer({
      context: baseContext,
      key: "t-1",
      referenceMonth: new Date("2026-09-01T00:00:00Z"),
      sourceAccountId: "account-1",
      destinationAccountId: "account-2",
      amount: 50n,
      currency: "USD",
    });
    expect(transfer).toMatchObject({
      bookId: "1",
      amount: 50n,
      currency: "USD",
    });
  });

  test("rejects a transfer with an invalid amount", async () => {
    const application = createApplication({
      createTransfer: async () => {
        throw new Error("should not be called");
      },
    });
    await expect(
      application.createTransfer({
        context: baseContext,
        key: "t-1",
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        sourceAccountId: "account-1",
        destinationAccountId: "account-2",
        amount: 0n,
        currency: "USD",
      }),
    ).rejects.toThrow("amount must be positive");
  });

  test("forbidden revenue mutations do not reach the repository", async () => {
    let called = false;
    const application = createApplication({
      createRevenue: async () => {
        called = true;
        return { id: "revenue-1" } as never;
      },
    });
    await expect(
      application.createRevenue({
        context: { ...baseContext, role: "VIEWER" },
        key: "rev-1",
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        partyId: "party-1",
        categoryId: "category-1",
        amount: 200n,
        currency: "USD",
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(called).toBe(false);
  });
});

describe("catalog commands", () => {
  test("forwards institutionId when creating an account", async () => {
    // Regression: the command carried institutionId but the handler dropped it,
    // so every account created through the API or MCP came back unlinked.
    let created: Record<string, unknown> | undefined;
    const application = createApplication({
      createAccount: async (input) => {
        created = input as Record<string, unknown>;
        return { id: "account-1", ...input };
      },
    });

    await application.createAccount({
      context: baseContext,
      key: "checking",
      name: "Checking",
      type: "CHECKING",
      institutionId: "7",
    });

    expect(created?.institutionId).toBe("7");
  });

  test("an update sends only the fields it was given", async () => {
    let patched: Record<string, unknown> | undefined;
    const application = createApplication({
      updateAccount: async (input) => {
        patched = input as Record<string, unknown>;
        return { id: "account-1", bookId: "1", key: "k", name: "n", type: "t" };
      },
    });

    await application.updateAccount({
      context: baseContext,
      id: "account-1",
      name: "Primary Checking",
    });

    expect(patched?.name).toBe("Primary Checking");
    expect(patched?.key).toBeUndefined();
    expect(patched?.type).toBeUndefined();
  });

  test("a VIEWER cannot mutate the catalog", async () => {
    let called = false;
    const application = createApplication({
      updateCategory: async () => {
        called = true;
        return { id: "1" } as never;
      },
    });

    await expect(
      application.updateCategory({
        context: { ...baseContext, role: "VIEWER" },
        id: "1",
        name: "Renamed",
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(called).toBe(false);
  });
});
