/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ForbiddenError,
  type Result,
  addMoney,
  assertAuthorized,
  assertExecutionContext,
  availableBalance,
  financialStatus,
  installment,
  money,
  operations,
  validateTransferPair,
} from "./index";

function resultValue<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

const context = {
  actorId: "user-1",
  bookId: "1",
  role: "OWNER" as const,
  source: "API" as const,
  correlationId: "correlation-1",
};

describe("execution context", () => {
  test("requires every field", () => {
    for (const field of [
      "actorId",
      "bookId",
      "role",
      "source",
      "correlationId",
    ]) {
      const input = { ...context, [field]: "" };
      expect(() => assertExecutionContext(input)).toThrow(new RegExp(field));
    }
  });
});

describe("expense cycle domain", () => {
  test("keeps Money immutable and rejects invalid and mismatched values", () => {
    const usd = money(100n, "USD");
    const brl = money(100n, "BRL");
    expect(usd.ok && brl.ok).toBe(true);
    if (!usd.ok || !brl.ok) return;
    expect(addMoney(usd.value, brl.value).ok).toBe(false);
    expect(money(-1n, "USD").ok).toBe(false);
    expect(usd.value).toEqual({ minor: 100n, currency: "USD" });
  });

  test("derives balances and statuses from active settlements", () => {
    const total = money(100n, "USD");
    const partial = money(40n, "USD");
    const full = money(60n, "USD");
    if (!total.ok || !partial.ok || !full.ok) return;
    expect(resultValue(financialStatus(total.value, []))).toBe("OPEN");
    expect(
      resultValue(financialStatus(total.value, [{ amount: partial.value }])),
    ).toBe("PARTIALLY_SETTLED");
    expect(
      resultValue(
        financialStatus(total.value, [
          { amount: partial.value },
          { amount: full.value },
        ]),
      ),
    ).toBe("SETTLED");
    expect(
      resultValue(availableBalance(total.value, [{ amount: partial.value }])),
    ).toEqual({ minor: 60n, currency: "USD" });
    expect(
      resultValue(
        financialStatus(total.value, [
          { amount: total.value, voidedAt: new Date() },
        ]),
      ),
    ).toBe("OPEN");
  });

  test("validates installment bounds", () => {
    expect(installment(1, 3).ok).toBe(true);
    expect(installment(0, 3).ok).toBe(false);
    expect(installment(1, 0).ok).toBe(false);
    expect(installment(4, 3).ok).toBe(false);
  });
});

describe("revenue cycle domain", () => {
  test("derives revenue status from active RevenueSettlements and is not directly assignable", () => {
    const total = money(200n, "USD");
    const partial = money(80n, "USD");
    const remaining = money(120n, "USD");
    if (!total.ok || !partial.ok || !remaining.ok) return;
    expect(resultValue(financialStatus(total.value, []))).toBe("OPEN");
    expect(
      resultValue(financialStatus(total.value, [{ amount: partial.value }])),
    ).toBe("PARTIALLY_SETTLED");
    expect(
      resultValue(
        financialStatus(total.value, [
          { amount: partial.value },
          { amount: remaining.value },
        ]),
      ),
    ).toBe("SETTLED");
    expect(
      resultValue(availableBalance(total.value, [{ amount: partial.value }])),
    ).toEqual({ minor: 120n, currency: "USD" });
  });

  test("validates a transfer pair links source and destination in one Book and currency", () => {
    const valid = validateTransferPair({
      bookId: "1",
      sourceAccountId: "10",
      destinationAccountId: "11",
      amountMinor: 1000n,
      currency: "BRL",
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.value).toEqual({
      sourceAccountId: "10",
      destinationAccountId: "11",
    });
    expect(
      validateTransferPair({
        bookId: "",
        sourceAccountId: "10",
        destinationAccountId: "11",
        amountMinor: 1000n,
        currency: "BRL",
      }).ok,
    ).toBe(false);
    expect(
      validateTransferPair({
        bookId: "1",
        sourceAccountId: "10",
        destinationAccountId: "10",
        amountMinor: 1000n,
        currency: "BRL",
      }).ok,
    ).toBe(false);
    expect(
      validateTransferPair({
        bookId: "1",
        sourceAccountId: "10",
        destinationAccountId: "11",
        amountMinor: 0n,
        currency: "BRL",
      }).ok,
    ).toBe(false);
  });

  test("rejects settling a transfer endpoint against an expense or revenue", () => {
    const expenseSettlement = validateTransferPair({
      bookId: "1",
      sourceAccountId: "10",
      destinationAccountId: "11",
      amountMinor: 1000n,
      currency: "BRL",
    });
    expect(expenseSettlement.ok).toBe(true);
  });
});

describe("authorization matrix", () => {
  test("allows read access to every role and financial writes to editors", () => {
    for (const role of ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const) {
      expect(() =>
        assertAuthorized({ ...context, role }, operations.listAccounts),
      ).not.toThrow();
    }
    for (const role of ["OWNER", "ADMIN", "EDITOR"] as const) {
      expect(() =>
        assertAuthorized({ ...context, role }, operations.createExpense),
      ).not.toThrow();
    }
    expect(() =>
      assertAuthorized(
        { ...context, role: "VIEWER" },
        operations.createExpense,
      ),
    ).toThrow(ForbiddenError);
  });

  test("keeps forbidden errors stable", () => {
    expect(() =>
      assertAuthorized(
        { ...context, role: "VIEWER" },
        operations.createAccount,
      ),
    ).toThrow("FORBIDDEN");
  });
});
