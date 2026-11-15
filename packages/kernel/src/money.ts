/**
 * Money as a value: a `bigint` in the currency's minor unit.
 *
 * There is no floating point path here and there should not be one (ADR 4).
 */
import { InvalidMoneyError, type Result } from "./errors";

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

export function magnitude(amount: bigint): bigint {
  return amount < 0n ? -amount : amount;
}

/** A positive amount in a three-letter currency, or the reason it is not one. */
export function requirePositiveMoney(amount: bigint, currency: string): Money {
  if (typeof amount !== "bigint" || amount <= 0n) {
    throw new InvalidMoneyError("amount must be positive");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidMoneyError(
      "currency must be a three-letter uppercase code",
    );
  }
  return Object.freeze({ amount, currency });
}
