/**
 * The four explicit financial records and the settlements that link them.
 *
 * An expense is not a payment and a revenue is not a receipt (ADR 2), which is
 * why there is no universal `transactions` type here. A transfer is neither.
 */
import { InvalidMoneyError, LastroError, type Result } from "./errors";
import type { PaymentMethod } from "./movements";
export type Expense = {
  id: string;
  bookId: string;
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  /** A label for this specific debt. See the schema for why it exists
   * alongside party and category. */
  name?: string | null;
  amount?: bigint;
  currency?: string;
  occurredAt?: Date;
  createdAt?: Date;
};

export type Revenue = {
  id: string;
  bookId: string;
  key: string;
  referenceMonth: Date;
  partyId: string;
  categoryId: string;
  /** See `Expense.name`. */
  name?: string | null;
  amount?: bigint;
  currency?: string;
  occurredAt?: Date;
  createdAt?: Date;
};

export type Receipt = {
  id: string;
  bookId: string;
  accountId: string;
  /**
   * A derived handle that makes a day's deposit findable instead of
   * duplicated: `recv-<account>-<party>-<date>`. An acquirer settles a day in
   * several lines and they are one arrival. Null for a receipt entered by hand.
   */
  key?: string | null;
  referenceMonth: Date;
  amount: bigint;
  currency: string;
  /**
   * How the money moved. `accountId` says where; this says how. Null when the
   * statement never said — a line naming only a supplier records no method,
   * and an empty field is worth more than a plausible one.
   */
  method?: PaymentMethod | null;
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
  /** What this allocation was, in the operator's own words. Optional. */
  description?: string | null;
  voidedAt?: Date | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt?: Date;
};

export type Payment = {
  id: string;
  bookId: string;
  accountId: string;
  /**
   * A derived handle that makes a bill findable instead of duplicated. A card
   * is paid once a month, so every purchase on one invoice reaches the same
   * payment through `card-<account>-<month>`. Null for a payment made by hand.
   */
  key?: string | null;
  referenceMonth: Date;
  amount: bigint;
  currency: string;
  /**
   * How the money moved. `accountId` says where; this says how. Null when the
   * statement never said — a line naming only a supplier records no method,
   * and an empty field is worth more than a plausible one.
   */
  method?: PaymentMethod | null;
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
  /** What this allocation was, in the operator's own words. Optional. */
  description?: string | null;
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
  /** See `Expense.name`. */
  name?: string | null;
  amount: bigint;
  currency: string;
  occurredAt?: Date;
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
