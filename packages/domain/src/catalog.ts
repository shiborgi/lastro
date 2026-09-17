/**
 * What a Book names before it can record money: the Book itself, the
 * institutions and accounts, the parties it deals with, the statement
 * descriptors that map a line's text onto them, and the chart of accounts.
 */
import type { PaymentMethod } from "./movements";
export type Book = {
  id: string;
  name: string;
  createdAt?: Date;
};

export const accountTypes = ["CARD", "ACCOUNT", "INVESTMENT", "CASH"] as const;

/**
 * The four kinds of place money sits.
 *
 * Constrained rather than free text because the type decides what a movement
 * against the account can mean — a CARD is settled by paying its invoice, an
 * ACCOUNT moves cash directly — so a typo would otherwise create a fifth kind
 * nothing knows how to handle.
 */
export type AccountType = (typeof accountTypes)[number];

export type Institution = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  createdAt?: Date;
};

export type Account = {
  id: string;
  bookId: string;
  key: string;
  institutionId?: string | null;
  /**
   * The number the institution prints — a checking account's, or a card's last
   * four digits. With the institution it is what a statement line matches
   * against to find the account it came from.
   */
  number?: string | null;
  name: string;
  type: string;
  createdAt?: Date;
};

export type Party = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  type: string;
  createdAt?: Date;
};

/**
 * What a statement descriptor means: who was on the other side, under what
 * category, paid how.
 *
 * One mapping rather than two tables, because on every export measured so far
 * the text that names the counterparty is the same text that names the rail —
 * two of three real files produced byte-identical keys for both, and none
 * produced a descriptor needing two different methods.
 *
 * Every destination is nullable: the import records what it saw and a person
 * decides what it means (ADR 8). `method` is the one the import may pre-fill,
 * from the line's own wording — and because nothing marks a filled value as
 * inferred rather than decided, a re-import never revisits it.
 */
export type CardDescriptor = {
  id: string;
  bookId: string;
  /** Whose statement this descriptor came from. Descriptors are per account. */
  accountId: string;
  key: string;
  partyId?: string | null;
  categoryId?: string | null;
  /** A label for the expense this promotes to. See the schema for why. */
  name?: string | null;
  createdAt?: Date;
};

/** See `CardDescriptor`. This is the side where method and destination vary. */
export type AccountDescriptor = {
  id: string;
  bookId: string;
  /** Whose statement this descriptor came from. Descriptors are per account. */
  accountId: string;
  key: string;
  partyId?: string | null;
  categoryId?: string | null;
  method?: PaymentMethod | null;
  /**
   * The other side of a transfer — and, by being set at all, the declaration
   * that this is one. A `kind` field used to say the same thing beside it; see
   * the schema for why it went.
   */
  counterAccountId?: string | null;
  /** A label for the expense or revenue this promotes to. Never a transfer. */
  name?: string | null;
  createdAt?: Date;
};

/**
 * A card's billing cycle, one row per invoice, filled by hand.
 *
 * `referenceMonth` is the invoice; `startDate` and `endDate` are the window of
 * purchases it covers. No statement states it — the invoice prints purchases
 * and their dates and never says which window produced them, and the boundary
 * moves with weekends — so promotion reads what the operator registered here
 * to decide which invoice a purchase lands on.
 *
 * The due date is deliberately not a column: promotion derives it from the
 * cycle a purchase falls in and then steps monthly per instalment, and a
 * stored copy could disagree with the schedule it produced.
 */
export type AccountReferenceMonth = {
  id: string;
  bookId: string;
  accountId: string;
  referenceMonth: Date;
  startDate: Date;
  endDate: Date;
  createdAt?: Date;
};

export type CategoryKind = "EXPENSE" | "REVENUE";

export type Category = {
  id: string;
  bookId: string;
  /**
   * The group this sits inside, one level only. Null means it is a group
   * itself, or a category standing alone. A group holds categories and never
   * records, so a roll-up is a plain sum over its children.
   */
  parentId?: string | null;
  kind: CategoryKind;
  name: string;
  createdAt?: Date;
};
