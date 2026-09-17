/**
 * Grouping a day's incoming money into the earning it actually was.
 *
 * An acquirer settles a day of sales in several lines — one per flag and per
 * function, six of them on the measured statement — and they are one
 * customer relationship's earnings for the day, not six. So promoting an
 * inflow writes a receipt per line, matching the bank statement exactly, and
 * shares one revenue per counterparty per day that they all settle against.
 * The settlements carry the descriptor, which is what still says which flag
 * each part came from once they are added together.
 *
 * The mirror of the card side, one level finer: a card is paid once a month,
 * an acquirer earns once a day.
 */
import type { PaymentMethod } from "@lastro/domain";

/** The day, in UTC, so a date never shifts under the host's timezone. */
export function dayOf(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * The key that decides whether a day's earnings from one payer exist yet.
 *
 * Per counterparty as well as per day: Stone settling and a meal-voucher
 * operator settling on the same day are two earnings from two payers, and
 * merging them would produce a revenue no single relationship explains.
 */
export function revenueKeyFor(
  accountId: string,
  partyId: string,
  date: Date,
): string {
  return `recv-${accountId}-${partyId}-${dayOf(date)}`;
}

/**
 * How incoming money arrived: Pix when the line says so, a transfer otherwise.
 *
 * Only two answers, and the reason is a fact about acquiring rather than a
 * simplification. The descriptor may well have inferred DEBIT_CARD from
 * "CART. DEBIT - Stone Pagamento - Maestro", and that is true of how the
 * *customer* paid — but what reaches the account is Stone's deposit, and a
 * deposit arrives by Pix or by transfer. Recording the customer's rail on the
 * receipt would claim the bank moved money in a way it did not.
 *
 * The descriptor keeps its own inference untouched. That records what the
 * line's text implied; this records how the money came in. Two facts.
 */
export function receiptMethodFor(
  inferred: PaymentMethod | null | undefined,
): PaymentMethod {
  return inferred === "PIX" ? "PIX" : "TRANSFER";
}
