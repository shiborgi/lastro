/**
 * The identity of a transfer, as seen from either side of it.
 *
 * A transfer between two of your own accounts appears on two statements: money
 * leaving one and money arriving in the other. Both are the same event, and
 * keying the ledger record on the movement that produced it wrote the event
 * twice — the ledger then said twice as much money moved as did.
 *
 * What makes one key out of two sightings is that promotion already normalises
 * the direction: it reads the sign and puts the payer first either way, so the
 * outflow on A naming B and the inflow on B naming A both resolve to the pair
 * A → B. With the pair settled, the amount and the day finish the identity.
 *
 * `occurrence` is the one field that looks surprising and is doing real work.
 * It is the index among *identical* rows inside one file, so two transfers of
 * the same amount between the same accounts on the same day are 1 and 2 on
 * each statement — and pairing 1 with 1 keeps them two events instead of
 * collapsing them into one and losing money. Where the two banks happen to
 * list them in different orders the result is two half-paired transfers, which
 * is wrong but visible, rather than one that silently swallowed the other.
 */
import { createHash } from "node:crypto";

export interface TransferEvent {
  /** Who paid. Normalised by the sign, so both sides agree. */
  sourceAccountId: string;
  destinationAccountId: string;
  /** Absolute minor units. */
  amount: bigint;
  /** The day the statement put on the line. */
  date: Date;
  /** Index among identical rows inside the file. See the module comment. */
  occurrence: number;
}

export function transferKeyFor(event: TransferEvent): string {
  const payload = [
    event.sourceAccountId,
    event.destinationAccountId,
    event.amount.toString(),
    event.date.toISOString().slice(0, 10),
    String(event.occurrence),
  ].join("\u0000");
  return `xfer-${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}
