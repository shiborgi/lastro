import type { MovementStatus } from "./account-movements";
/**
 * Card movement evidence (ADR 18): the lines of a card invoice, the
 * descriptors that say who a purchase name is and what it buys, and the two
 * links a posted purchase leaves: one to its expense, one per instalment to
 * the invoice payment that instalment is billed on.
 *
 * A financed purchase is one debt with several due dates, so it is one
 * expense settled into N invoice payments, one per instalment. The invoice an
 * instalment is billed on comes from the card's billing windows
 * (`account_cycles`): the window holding the purchase date names
 * the first invoice, and each later instalment is one month after it. Every
 * purchase billed in one month settles into the same payment, because a card
 * is paid once a month.
 */
import type { PaymentMethod } from "./records";

/** What a card parser reads from one invoice line, in Lastro's units. */
export type CardObservation = {
  /** The line's text: its hash is the statement id, this invoice's line. */
  line: string;
  /**
   * The line's text with `Parcela` reduced to the count (`/12`): its hash is
   * the external id, the purchase, the same on every invoice.
   */
  purchaseLine: string;
  /** The purchase date, never the invoice's: instalment 5/12 keeps April. */
  occurredOn: Date;
  /** Signed minor units: positive is a charge, negative a credit (the invoice paid, a refund). */
  amount: bigint;
  currency: string;
  /** Who is on the other side, as the line names them; the descriptor key comes from it. */
  name: string;
  description: string;
  cardholder: string | null;
  cardLast4: string | null;
  /** The issuer's own classification of the merchant, kept as information. */
  providerCategory: string | null;
  installmentNumber: number;
  installmentCount: number;
};

/**
 * What a card name posts as: a party and financial category (a purchase, or
 * with a DEDUCTION category a refund), or another account of the Book (the
 * invoice paid from it: a transfer into the card).
 */
export type CardMapping = {
  partyId: string | null;
  financialCategoryId: string | null;
  counterAccountId: string | null;
  paymentMethod: PaymentMethod | null;
};

export type CardDescriptor = CardMapping & {
  bookId: string;
  accountId: string;
  descriptorKey: string;
  name: string;
};

export type CardMovement = CardMapping & {
  id: string;
  bookId: string;
  accountId: string;
  fileId: string;
  /** The sha256 of the line's text: this invoice's line (`#2` onward for identical lines in one file). */
  statementId: string;
  /** The sha256 of the line without its current instalment: the purchase, and every link's external key. */
  externalId: string;
  /** The payment statement key: the instalment this line shows. */
  paymentKey: string;
  /** The expense statement key: the purchase, whatever the instalment. */
  expenseKey: string;
  occurredOn: Date;
  amount: bigint;
  currency: string;
  name: string;
  descriptorKey: string;
  description: string;
  cardholder: string | null;
  cardLast4: string | null;
  providerCategory: string | null;
  installmentNumber: number;
  installmentCount: number;
  status: MovementStatus;
  ignoreReason: string | null;
};

/** The transfer an invoice payment became, with the key its other side finds it by. */
export type CardTransferLink = {
  bookId: string;
  accountId: string;
  movementId: string;
  /** The line's external id: its group. */
  externalKey: string;
  statementKey: string;
  transferId: string;
};

/** The expense a purchase became, found again by its expense key. */
export type CardExpenseLink = {
  bookId: string;
  accountId: string;
  expenseKey: string;
  expenseId: string;
};

/** One instalment: the invoice payment and settlement it is, and the line that showed it. */
export type CardPaymentLink = {
  bookId: string;
  accountId: string;
  paymentKey: string;
  expenseKey: string;
  installmentNumber: number;
  installmentCount: number;
  paymentId: string;
  settlementId: string;
  /** Null until an invoice line for this instalment is taken in. */
  movementId: string | null;
};

/**
 * The destination keys of a purchase, from its external id (the hash of its
 * line without the current instalment, the same on every invoice): the
 * expense key ends in the instalment count (`<external id>-12`), the payment
 * key in which instalment (`<external id>-5/12`).
 */
export function cardKeys(
  externalId: string,
  installmentCount: number,
): { expenseKey: string; paymentKey: (installment: number) => string } {
  return {
    expenseKey: `${externalId}-${installmentCount}`,
    paymentKey: (installment) =>
      `${externalId}-${installment}/${installmentCount}`,
  };
}

/** The payment key of instalment `installment` of the purchase with this expense key. */
export function paymentKeyOf(expenseKey: string, installment: number): string {
  const match = /^(.*)-(\d+)$/.exec(expenseKey);
  if (!match) throw new Error(`not an expense key: ${expenseKey}`);
  const [, base, count] = match;
  return `${base}-${installment}/${count}`;
}

/** A billing window as registered for the card, with the day its invoice is due. */
export type BillingWindow = {
  referenceMonth: Date;
  startsOn: Date;
  endsOn: Date;
  dueOn: Date;
};

export function monthOf(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function addMonths(month: Date, count: number): Date {
  return new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + count, 1),
  );
}

/* The same day `count` months on, kept inside a shorter month (31 → 30). */
function addMonthsToDay(value: Date, count: number): Date {
  const target = addMonths(value, count);
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(value.getUTCDate(), last),
    ),
  );
}

/**
 * The window a purchase date is billed on, or null. There is no guess by
 * calendar month: the boundary moves with weekends and holidays, and a
 * purchase on the wrong invoice is a wrong due date.
 */
export function windowOf(
  occurredOn: Date,
  windows: readonly BillingWindow[],
): BillingWindow | null {
  const at = occurredOn.getTime();
  return (
    windows.find(
      (each) => each.startsOn.getTime() <= at && at <= each.endsOn.getTime(),
    ) ?? null
  );
}

export function invoiceMonthOf(
  occurredOn: Date,
  windows: readonly BillingWindow[],
): Date | null {
  const window = windowOf(occurredOn, windows);
  return window ? monthOf(window.referenceMonth) : null;
}

/** One instalment's invoice: its month and the day it is due. */
export type ScheduledInvoice = { month: Date; dueOn: Date };

/**
 * The invoice of each instalment: the window holding the purchase names the
 * first, and each next is one month later. An invoice's due date is its
 * window's `dueOn`; for a month whose window is not registered yet, the first
 * window's due day carried forward.
 */
export function scheduleOf(
  first: BillingWindow,
  count: number,
  windows: readonly BillingWindow[],
): ScheduledInvoice[] {
  const start = monthOf(first.referenceMonth);
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(start, index);
    const registered = windows.find(
      (each) => monthOf(each.referenceMonth).getTime() === month.getTime(),
    );
    return {
      month,
      dueOn: registered?.dueOn ?? addMonthsToDay(first.dueOn, index),
    };
  });
}

/** One invoice payment per card and month, found again by this key. */
export function invoicePaymentKey(accountId: string, month: Date): string {
  return `card-${accountId}-${month.toISOString().slice(0, 7)}`;
}

/**
 * Why a card line cannot post yet, or null when it can.
 * - The invoice paid: a credit whose descriptor names the account it was paid
 *   from, with a payment method. It is a transfer into the card.
 * - A purchase: a charge under an expense category that is not a DEDUCTION,
 *   on a date a billing window holds.
 * - A refund: a credit under a DEDUCTION expense category, posted as a
 *   discount, on a date a billing window holds.
 */
export function cardIneligibility(
  movement: Pick<CardMovement, "amount" | keyof CardMapping>,
  deduction: boolean | null,
  window: BillingWindow | null,
  occurredOn: Date,
): string | null {
  if (movement.counterAccountId) {
    if (movement.amount > 0n)
      return "a transfer from another account pays the invoice: it is a credit on the card, not a charge";
    if (!movement.paymentMethod)
      return "a transfer needs its descriptor's payment method: it is part of the statement key";
    return null;
  }
  if (!movement.partyId || !movement.financialCategoryId || deduction === null)
    return "its descriptor has no party and financial category, or account, yet";
  if (movement.amount > 0n && deduction)
    return "a charge is a purchase: its descriptor needs an expense category that is not a DEDUCTION";
  if (movement.amount > 0n && !movement.paymentMethod)
    return "a purchase needs its descriptor's payment method: the invoice payment records it";
  if (movement.amount < 0n && !deduction)
    return "a credit is a refund, posted as a discount, or the invoice paid, a transfer: its descriptor needs a DEDUCTION expense category or the account it was paid from";
  if (!window)
    return `no billing window holds ${occurredOn.toISOString().slice(0, 10)}; register it with create_account_cycle`;
  return null;
}
