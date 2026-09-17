import type { PaymentMethod } from "@lastro/domain";
import type { MethodRule } from "./method";

/**
 * The contract every bank plugin implements.
 *
 * A plugin turns one institution's export into rows this ledger understands.
 * It never decides what a line *means* — that a charge is an expense, that a
 * negative amount is a refund — because that is the review step's judgement
 * (ADR 8). A plugin only reads.
 *
 * Deliberately absent: any hashing or numbering. `key` and `occurrence` are
 * computed by the import, from the parsed fields, so that dedup semantics live
 * in one place. A plugin that computed its own would let two callers disagree
 * about whether a row is the same row.
 */

/** One parsed line of a card statement. */
export interface CardStatementRow {
  purchaseDate: Date;
  /**
   * The text that names who was on the other side, when that is not
   * `description`. Measured on the real C6 statement, `description` alone
   * collapses four different Pix recipients into one row of "TRANSF ENVIADA
   * PIX" — mapping that alias would attribute twenty movements to whichever
   * party was picked. Which field carries the counterparty is knowledge about
   * one bank's format, so the plugin supplies it and the import stays uniform.
   */
  counterparty?: string;
  cardholder?: string;
  cardNumber?: string;
  /** The issuer's own category, verbatim. Never a Lastro category. */
  category?: string;
  /** The institution's own heading for the line, verbatim. Evidence only. */
  title?: string;
  description: string;
  installmentNumber?: number;
  installmentCount?: number;
  /** Minor units. Positive is a charge; negative a credit or bill payment. */
  amount: bigint;
  currency: string;
}

/**
 * One parsed line of a checking-account statement.
 *
 * The same shape as a card line minus the card, because the two movement
 * tables converged onto one. `purchaseDate` is named as the card's is and
 * means something different — an account statement dates money moving, an
 * invoice dates the purchase — which is why the daily cash series is built
 * from account statements only.
 */
export interface AccountStatementRow {
  purchaseDate: Date;
  /** See `CardStatementRow.counterparty` — same rule, same reason. */
  counterparty?: string;
  /** The institution's own category, verbatim. Never a Lastro category. */
  category?: string;
  /** The institution's own heading for the line, verbatim. Evidence only. */
  title?: string;
  description: string;
  /** Minor units. Positive is money in; negative money out. */
  amount: bigint;
  currency: string;
}

/**
 * Statement-level facts a plugin may recover from a preamble.
 *
 * The period is no longer among them: which account a row belongs to is now
 * `account_id`, stated at import, so the preamble's own account number and
 * branch are kept as printed evidence rather than as identity.
 */
export interface StatementHeader {
  branch?: string;
  accountNumber?: string;
}

export type StatementKind = "card" | "account";

export interface CardStatement {
  kind: "card";
  header: StatementHeader;
  rows: CardStatementRow[];
}

export interface AccountStatement {
  kind: "account";
  header: StatementHeader;
  rows: AccountStatementRow[];
}

export type ParsedStatement = CardStatement | AccountStatement;

export interface StatementPlugin {
  /** `<institution>/<kind>`, matching the storage layout. */
  id: string;
  institutionKey: string;
  kind: StatementKind;
  /**
   * The rail every line of this document took, before any wording is read, or
   * null when the document establishes none.
   *
   * Declared per plugin rather than derived from `kind`. "A card invoice means
   * credit card" is true of *this* invoice: a prepaid or debit-card export
   * registered under the same kind would be labelled wrong by a shared rule,
   * silently, on every descriptor it created.
   */
  methodFloor: PaymentMethod | null;
  /**
   * Wording only this institution prints, tried before the shared vocabulary.
   *
   * PIX, TED, DOC and BOLETO are Brazilian banking in general and stay shared.
   * `CRED LOJ C DEBITO` is the value C6 puts in one column, and belongs to the
   * plugin that reads that column — otherwise adding a bank means editing a
   * list every other bank depends on.
   */
  methodRules: readonly MethodRule[];
  parse: (content: string) => ParsedStatement;
}

/** A file that does not look like what the plugin expects. */
export class StatementFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementFormatError";
  }
}

/** `DD/MM/YYYY` — the only date shape these exports use. */
export function parseBrazilianDate(value: string, field: string): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    throw new StatementFormatError(`${field} is not DD/MM/YYYY: "${value}"`);
  }
  const [, day, month, year] = match;
  // UTC, so a date never shifts a day under the host's timezone.
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/**
 * `716.66` → `71666n`. Parsed as digits rather than through a float, because
 * `716.66 * 100` is `71665.99999999999` and money that rounds is money that is
 * wrong.
 */
export function parseDecimalToMinor(value: string, field: string): bigint {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new StatementFormatError(
      `${field} is not a decimal amount: "${value}"`,
    );
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  const cents = `${fraction}00`.slice(0, 2);
  return BigInt(`${sign}${whole}${cents}`);
}
