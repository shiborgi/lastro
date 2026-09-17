/**
 * Turning one card purchase into the instalment schedule it committed to.
 *
 * A financed purchase is one debt with several due dates, so promoting it
 * writes one expense and N settlements — one per instalment — each against the
 * payment for the invoice it falls on. The invoices are shared: every purchase
 * billed in September settles against the same September payment, because a
 * card is paid once a month, not once per purchase.
 *
 * Which invoice a purchase starts on is the only part a file cannot answer. The
 * C6 statement prints the purchase and its date and never says which billing
 * window produced it, and the boundary moves with weekends and holidays — so
 * the windows are registered by hand in `account_reference_month`, and this
 * reads them. With no window on record it falls back to the purchase's own
 * month, which is right whenever the cycle happens to be calendar-aligned and
 * wrong by at most one invoice when it is not.
 */
import { createHash } from "node:crypto";

/**
 * Stable across processes, and separated by a byte the fields cannot contain
 * so `["a b", "c"]` and `["a", "b c"]` cannot collide into one digest.
 */
function hashFields(
  parts: (string | number | bigint | null | undefined)[],
): string {
  const payload = parts
    .map((part) => (part == null ? "" : String(part)))
    .join("\u0000");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/** A billing window as the operator registered it. */
export interface ReferenceWindow {
  referenceMonth: Date;
  startDate: Date;
  endDate: Date;
}

/** One instalment: which number it is, and the invoice it lands on. */
export interface ScheduledInstalment {
  installmentNumber: number;
  installmentCount: number;
  /** The invoice month this instalment is billed on. */
  referenceMonth: Date;
}

/** The first day of a month, in UTC, so a date never shifts under a timezone. */
export function monthOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** `monthOf` plus n months, carrying the year. */
export function addMonths(month: Date, n: number): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1));
}

/**
 * The invoice a purchase lands on: the window that contains its date, or the
 * purchase's own month when no window is registered.
 *
 * Compared on the day, not the instant, because a window is registered as two
 * dates and a purchase carries a date — mixing in a time would put a purchase
 * made on the closing day outside its own window.
 */
export function referenceMonthFor(
  purchaseDate: Date,
  windows: readonly ReferenceWindow[],
): { referenceMonth: Date; fromWindow: boolean } {
  const day = Date.UTC(
    purchaseDate.getUTCFullYear(),
    purchaseDate.getUTCMonth(),
    purchaseDate.getUTCDate(),
  );
  const match = windows.find((window) => {
    const start = Date.UTC(
      window.startDate.getUTCFullYear(),
      window.startDate.getUTCMonth(),
      window.startDate.getUTCDate(),
    );
    const end = Date.UTC(
      window.endDate.getUTCFullYear(),
      window.endDate.getUTCMonth(),
      window.endDate.getUTCDate(),
    );
    return day >= start && day <= end;
  });
  return match
    ? { referenceMonth: monthOf(match.referenceMonth), fromWindow: true }
    : { referenceMonth: monthOf(purchaseDate), fromWindow: false };
}

/**
 * The whole schedule: the first invoice from the windows, then one month per
 * instalment after it.
 *
 * `count` of 1 — which is 48 of the 54 rows on the measured invoice — produces
 * a single entry, so the unfinanced case is not a special path.
 */
export function scheduleFor(
  purchaseDate: Date,
  count: number,
  windows: readonly ReferenceWindow[],
): ScheduledInstalment[] {
  const first = referenceMonthFor(purchaseDate, windows).referenceMonth;
  const total = Number.isInteger(count) && count > 0 ? count : 1;
  return Array.from({ length: total }, (_, index) => ({
    installmentNumber: index + 1,
    installmentCount: total,
    referenceMonth: addMonths(first, index),
  }));
}

/**
 * Splitting the total across the instalments so the parts add back up to it.
 *
 * The remainder goes on the first instalment, which is what card issuers do and
 * what makes the sum exact: 100.00 in 3 is 33.34 + 33.33 + 33.33, never three
 * parts that miss the total by a cent. A ledger whose settlements do not sum to
 * the expense is a ledger that cannot close.
 */
export function splitAmount(total: bigint, count: number): bigint[] {
  const parts = Number.isInteger(count) && count > 0 ? count : 1;
  const each = total / BigInt(parts);
  const remainder = total - each * BigInt(parts);
  return Array.from({ length: parts }, (_, index) =>
    index === 0 ? each + remainder : each,
  );
}

/**
 * The key that decides whether a card invoice's payment exists yet.
 *
 * One payment per account per month: the September invoice is one bill, however
 * many purchases it carries. Derived rather than looked up, so two purchases
 * promoted in either order collide on the ledger's own unique key instead of
 * opening a second bill for the same month.
 */
export function paymentKeyFor(accountId: string, referenceMonth: Date): string {
  const month = monthOf(referenceMonth).toISOString().slice(0, 7);
  return `card-${accountId}-${month}`;
}

/**
 * What makes two invoice lines the same purchase.
 *
 * A financed purchase appears once on every invoice it is billed on: the same
 * merchant, the same purchase date, the same instalment count, a different
 * instalment number. So promoting `6/12` next month has to find the expense
 * `5/12` already created rather than open a second one for the same debt.
 *
 * The instalment number is deliberately *not* in the hash — it is the one
 * field that changes — and the instalment amount deliberately is. That choice
 * picks which error is possible:
 *
 * - Without the amount, two identical purchases at one merchant on one day
 *   with the same instalment count would hash alike, and the second would be
 *   silently treated as already registered. Money would go missing with no
 *   trace.
 * - With it, an issuer that varies the instalments — putting a remainder on
 *   the first — would split one purchase into two expenses. That is wrong too,
 *   but it is *visible*: a duplicate on the screen, correctable.
 *
 * Silent under-counting is the worse failure, so the amount is in. Measured on
 * the real invoice, all six financed purchases divide exactly into equal
 * instalments, so the split case is not one this issuer produces.
 */
export function purchaseHashFor(input: {
  accountId: string;
  purchaseDate: Date;
  descriptorKey: string;
  installmentCount: number;
  instalmentAmount: bigint;
}): string {
  return `card-${hashFields([
    input.accountId,
    input.purchaseDate.toISOString().slice(0, 10),
    input.descriptorKey,
    input.installmentCount,
    input.instalmentAmount,
  ])}`;
}
