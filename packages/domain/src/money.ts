/**
 * Money, installments, and the status derived from settlements.
 *
 * Amounts are `bigint` in the currency's minor unit. There is no floating
 * point path here and there should not be one (ADR 6). Status is computed from
 * the active settlements every time it is asked for, never stored (ADR 7).
 */
import {
  InvalidInstallmentError,
  InvalidMoneyError,
  type Result,
} from "./errors";
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
