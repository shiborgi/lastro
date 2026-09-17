/**
 * Staged statement rows, the descriptors still waiting to be mapped, and the
 * summary read over both.
 *
 * A movement is what a file said, never what it means: promotion into an
 * expense or a revenue is a separate, separately authorized step (ADR 8).
 */
/**
 * A descriptor the import recorded but nobody has finished mapping, with the
 * evidence for deciding: how many movements point at it, what they add up to,
 * when they ran, and how the institution itself classified them.
 *
 * `sourceCategories` is a hint and never an answer. The bank's taxonomy is not
 * this Book's chart of accounts — a real invoice files "BRASTEMP BY CULLIGAN"
 * under *Aluguel* — so it is shown to whoever decides and never applied.
 */
type PendingEvidence = {
  movements: number;
  total: bigint;
  firstSeen: Date | null;
  lastSeen: Date | null;
  sourceCategories: { value: string; count: number }[];
};

export type PendingCardDescriptor = {
  id: string;
  bookId: string;
  accountId: string;
  key: string;
  partyId: string | null;
  categoryId: string | null;
  name: string | null;
} & PendingEvidence;

export type PendingAccountDescriptor = {
  id: string;
  bookId: string;
  accountId: string;
  key: string;
  partyId: string | null;
  categoryId: string | null;
  method: PaymentMethod | null;
  counterAccountId: string | null;
  name: string | null;
} & PendingEvidence;

/**
 * What the summary is built on: how far the ledger is behind the statements,
 * the daily cash movement each account statement records, and what the booked
 * records add up to per category group.
 */
export type BookInsights = {
  gap: {
    stagedMovements: number;
    postedMovements: number;
    ledgerRecords: number;
    /** Both sides together, for the headline. */
    descriptors: number;
    descriptorsPending: number;
    /** Per side, because the review bench is split into card and account. */
    cardDescriptors: number;
    cardDescriptorsPending: number;
    accountDescriptors: number;
    accountDescriptorsPending: number;
  };
  /** One entry per statement file. Card invoices are absent by design. */
  cash: {
    source: string;
    days: { date: Date; inflow: bigint; outflow: bigint }[];
  }[];
  byGroup: {
    group: string | null;
    category: string;
    kind: "EXPENSE" | "REVENUE";
    total: bigint;
    count: number;
  }[];
};

/** Where a statement row stands in review. */
export type MovementStatus = "PENDING" | "IGNORED" | "POSTED";

export const paymentMethods = [
  "PIX",
  "BOLETO",
  /** TED and DOC alike: which rail cleared it is a detail the ledger has no use for. */
  "TRANSFER",
  "DEBIT_CARD",
  "CREDIT_CARD",
] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

/**
 * A staged card-statement line. `amount` keeps the statement's own sign:
 * positive is a charge, negative a credit or a bill payment.
 */
export type CardMovement = {
  id: string;
  bookId: string;
  institutionId: string;
  /**
   * The account this file belongs to, stated by the caller at import.
   *
   * Not derived from the row: the Nubank export prints no account number at
   * all, and a C6 invoice carries two card numbers that are two plastics on
   * one credit account. The account is a fact about the document.
   */
  accountId: string;
  source: string;
  key: string;
  occurrence: number;
  purchaseDate: Date;
  cardholder?: string | null;
  cardNumber?: string | null;
  category?: string | null;
  /** The institution's own heading for the line, verbatim. Evidence only. */
  title?: string | null;
  description: string;
  /**
   * `description` normalised — the movement's join to its descriptor. Written
   * at import and never updated, so a later change to the normalisation cannot
   * re-point a row that has already been reviewed.
   */
  descriptorKey: string;
  installmentNumber?: number | null;
  installmentCount?: number | null;
  amount: bigint;
  currency: string;
  status: MovementStatus;
  expenseId?: string | null;
  /** A promoted row names exactly one of the three, never two. */
  revenueId?: string | null;
  transferId?: string | null;
  importedAt?: Date;
};

/**
 * A staged account-statement line. `amount` follows this statement's own
 * convention — positive is money in, negative money out — which is the
 * opposite of the card's, because cash leaving an account and a charge on a
 * card are different facts.
 */
export type AccountMovement = {
  id: string;
  bookId: string;
  institutionId: string;
  /** See `CardMovement.accountId`. */
  accountId: string;
  source: string;
  key: string;
  occurrence: number;
  /**
   * The date the statement puts on the line. Named as the card's is, because
   * the two tables carry one shape — but they do not mean the same thing, and
   * the difference is load-bearing: an account statement dates money moving, an
   * invoice dates the purchase. That is why the daily cash series is built from
   * account statements only.
   */
  purchaseDate: Date;
  /** From the statement preamble, repeated on every row. */
  branch?: string | null;
  accountNumber?: string | null;
  /** The institution's own category, verbatim. Never a Lastro category. */
  category?: string | null;
  /** The institution's own heading for the line, verbatim. Evidence only. */
  title?: string | null;
  description: string;
  /** See `CardMovement.descriptorKey` — same rule, same reason. */
  descriptorKey: string;
  amount: bigint;
  currency: string;
  status: MovementStatus;
  expenseId?: string | null;
  /** A promoted row names exactly one of the three, never two. */
  revenueId?: string | null;
  transferId?: string | null;
  importedAt?: Date;
};
