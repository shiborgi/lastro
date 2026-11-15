/**
 * The expense cycle's records and the rules over their settlements.
 *
 * An expense is not a payment (ADR 2): an expense is what is owed, a payment
 * is money leaving an account, and a settlement allocates part of one to the
 * other. Status is derived from the active settlements, never stored (ADR 5).
 */
import { LastroError, magnitude } from "@lastro/kernel";

export const paymentMethods = [
  "PIX",
  "BOLETO",
  "TRANSFER",
  "DEBIT_CARD",
  "CREDIT_CARD",
] as const;
/** How the money moved; `accountId` says where. */
export type PaymentMethod = (typeof paymentMethods)[number];

export type Expense = {
  id: string;
  bookId: string;
  key: string;
  partyId: string;
  financialCategoryId: string;
  /** A label for this specific debt: party and category say who and what kind, never which. */
  name: string | null;
  /** Signed minor units; negative only in a DEDUCTION category (ADR 6). */
  amount: bigint;
  currency: string;
  referenceMonth: Date;
  occurredOn: Date | null;
  occurredAt: Date | null;
};

export type Payment = {
  id: string;
  bookId: string;
  accountId: string;
  key: string | null;
  method: PaymentMethod | null;
  /** The signed sum of the active settlements, kept by the database. */
  amount: bigint;
  currency: string;
  referenceMonth: Date;
  dueOn: Date | null;
  dueAt: Date | null;
  paidOn: Date | null;
  paidAt: Date | null;
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
  description: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
};

export class SignedItemError extends LastroError {
  constructor(message: string) {
    super("SIGNED_ITEM", message, 422);
    this.name = "SignedItemError";
  }
}

export const financialStatuses = [
  "OPEN",
  "PARTIALLY_SETTLED",
  "SETTLED",
] as const;
export type FinancialStatus = (typeof financialStatuses)[number];

type Allocation = { amount: bigint; voidedAt: Date | null };

/** What an item's active settlements cover and what remains, both signed like the item. */
export function settlementPosition(
  itemAmount: bigint,
  settlements: readonly Allocation[],
): { settled: bigint; outstanding: bigint; status: FinancialStatus } {
  let settled = 0n;
  for (const settlement of settlements) {
    if (settlement.voidedAt) continue;
    if (settlement.amount < 0n !== itemAmount < 0n)
      throw new SignedItemError("a settlement carries its item's sign");
    settled += settlement.amount;
  }
  const total = magnitude(itemAmount);
  const covered = magnitude(settled);
  const remaining = covered >= total ? 0n : total - covered;
  return {
    settled,
    outstanding: itemAmount < 0n ? -remaining : remaining,
    status:
      covered === 0n
        ? "OPEN"
        : covered >= total
          ? "SETTLED"
          : "PARTIALLY_SETTLED",
  };
}

export function assertInstallment(number: number, count: number): void {
  if (
    !Number.isInteger(number) ||
    !Number.isInteger(count) ||
    number < 1 ||
    number > count
  )
    throw new SignedItemError(
      "installmentNumber must be between 1 and installmentCount",
    );
}

/**
 * A discount obtained when paying (ADR 6) is a negative expense settled
 * beside the share it reduces, into the same payment. The entered discount is
 * positive and cannot exceed that share; the payment moves the difference.
 */
export function paymentDiscount(share: bigint, discount: bigint): bigint {
  if (share <= 0n || discount <= 0n || discount > share)
    throw new SignedItemError(
      "a discount must be positive and cannot exceed the expense share being paid",
    );
  return -discount;
}

/*
 * The revenue cycle mirrors the expense cycle: a revenue is what the Book
 * earned, a receipt is money arriving in an account, and a settlement
 * allocates part of one to the other (ADR 2).
 */

export type Revenue = {
  id: string;
  bookId: string;
  key: string;
  partyId: string;
  financialCategoryId: string;
  name: string | null;
  amount: bigint;
  currency: string;
  referenceMonth: Date;
  occurredOn: Date | null;
  occurredAt: Date | null;
};

export type Receipt = {
  id: string;
  bookId: string;
  accountId: string;
  key: string | null;
  method: PaymentMethod | null;
  /** The signed sum of the active settlements, kept by the database. */
  amount: bigint;
  currency: string;
  referenceMonth: Date;
  dueOn: Date | null;
  dueAt: Date | null;
  paidOn: Date | null;
  paidAt: Date | null;
};

export type RevenueSettlement = {
  id: string;
  bookId: string;
  revenueId: string;
  receiptId: string;
  amount: bigint;
  currency: string;
  description: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
};

/** One event between two accounts the Book controls; neither a payment nor a receipt. */
export type Transfer = {
  id: string;
  bookId: string;
  key: string;
  sourceAccountId: string;
  destinationAccountId: string;
  name: string | null;
  amount: bigint;
  currency: string;
  referenceMonth: Date;
  occurredOn: Date | null;
  occurredAt: Date | null;
};
