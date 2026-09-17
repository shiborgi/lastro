/**
 * Staged statement rows.
 *
 * Uniqueness is `(book_id, key, occurrence)`, which is what makes re-importing
 * a file a no-op while still keeping two genuinely identical purchases apart.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { account } from "./auth";
import { books } from "./books";
import {
  accountDescriptors,
  accounts,
  cardDescriptors,
  institutions,
} from "./catalog";
import { expenses, revenues, transfers } from "./financial";

export const cardMovements = pgTable(
  "card_movements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    institutionId: integer("institution_id").notNull(),
    /*
     * The account this file belongs to, stated by the caller at import.
     *
     * Not derived from the row: the Nubank export prints no account number at
     * all — it is only in the file name, which anyone can rename — and a C6
     * invoice carries two card numbers that are two plastics on one credit
     * account. So the account is a fact about the document, and the import is
     * told it rather than guessing.
     */
    accountId: integer("account_id").notNull(),
    /** Full path as it came from storage, e.g. `c6/cartao/Fatura.csv`. */
    source: text("source").notNull(),
    key: text("key").notNull(),
    /** 1-based index among identical rows inside `source`. */
    occurrence: integer("occurrence").notNull(),
    purchaseDate: date("purchase_date", { mode: "date" }).notNull(),
    cardholder: text("cardholder"),
    cardNumber: text("card_number"),
    /** The issuer's own category, verbatim; never used as a Lastro category. */
    category: text("category"),
    /** The institution's own heading for the line, verbatim. Evidence only. */
    title: text("title"),
    description: text("description").notNull(),
    /**
     * `description` normalised, and the join to `card_descriptors`. Written
     * once at import and never updated: it freezes the merchant this row was
     * matched to, so a later change to the normalisation cannot silently
     * re-point rows that have already been reviewed.
     */
    descriptorKey: text("descriptor_key").notNull(),
    installmentNumber: integer("installment_number"),
    installmentCount: integer("installment_count"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").default("BRL").notNull(),
    status: text("status").default("PENDING").notNull(),
    expenseId: integer("expense_id"),
    /*
     * A promoted row names an expense or a revenue, never both — which of the
     * two it becomes is decided by the sign, not by the caller. On a real
     * account statement 107 of 162 lines are money coming in, so revenue is
     * the majority case here rather than an afterthought.
     */
    revenueId: integer("revenue_id"),
    /*
     * The third destination. A line moving money between two of your own
     * accounts is neither a cost nor an earning, and marking it ignored would
     * lose the record of what it actually became.
     */
    transferId: integer("transfer_id"),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "card_movements_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    dedupUnique: uniqueIndex("card_movements_book_id_key_occurrence_uk").on(
      table.bookId,
      table.key,
      table.occurrence,
    ),
    statusIdx: index("card_movements_book_id_status_idx").on(
      table.bookId,
      table.status,
    ),
    purchaseDateIdx: index("card_movements_book_id_purchase_date_idx").on(
      table.bookId,
      table.purchaseDate,
    ),
    bookForeignKey: foreignKey({
      name: "card_movements_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    institutionForeignKey: foreignKey({
      name: "card_movements_book_id_institution_id_fk",
      columns: [table.bookId, table.institutionId],
      foreignColumns: [institutions.bookId, institutions.id],
    }),
    accountForeignKey: foreignKey({
      name: "card_movements_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    expenseForeignKey: foreignKey({
      name: "card_movements_book_id_expense_id_fk",
      columns: [table.bookId, table.expenseId],
      foreignColumns: [expenses.bookId, expenses.id],
    }),
    revenueForeignKey: foreignKey({
      name: "card_movements_book_id_revenue_id_fk",
      columns: [table.bookId, table.revenueId],
      foreignColumns: [revenues.bookId, revenues.id],
    }),
    transferForeignKey: foreignKey({
      name: "card_movements_book_id_transfer_id_fk",
      columns: [table.bookId, table.transferId],
      foreignColumns: [transfers.bookId, transfers.id],
    }),
    /*
     * Every movement names an existing alias. The import inserts the aliases
     * before the rows that reference them, and this is what stops an alias
     * being deleted while movements still depend on it — deleting one throws
     * away the mapping without touching the money it explains.
     */
    descriptorForeignKey: foreignKey({
      name: "card_movements_book_id_descriptor_key_fk",
      columns: [table.bookId, table.accountId, table.descriptorKey],
      foreignColumns: [
        cardDescriptors.bookId,
        cardDescriptors.accountId,
        cardDescriptors.key,
      ],
    }),
    descriptorIdx: index("card_movements_book_id_descriptor_idx").on(
      table.bookId,
      table.accountId,
      table.descriptorKey,
    ),
    statusCheck: check(
      "card_movements_status_check",
      sql`${table.status} in ('PENDING', 'IGNORED', 'POSTED')`,
    ),
    /*
     * A posted row names exactly one of the two, and a row that is not posted
     * names neither: the link is the whole record of what the review decided.
     * "Exactly one" is what stops a line being booked as both a cost and an
     * earning — the failure that would double a month.
     */
    postedLinkCheck: check(
      "card_movements_posted_link_check",
      sql`(${table.status} = 'POSTED') = ((${table.expenseId} is not null)::int + (${table.revenueId} is not null)::int + (${table.transferId} is not null)::int = 1)`,
    ),
    occurrenceCheck: check(
      "card_movements_occurrence_check",
      sql`${table.occurrence} >= 1`,
    ),
  }),
);

/**
 * One line of a checking-account statement, staged on the same terms as
 * `card_movements` — same dedup, same status, same link to the expense a review
 * eventually creates.
 *
 * The columns differ because the source does: two dates rather than one, a
 * running balance, no card and no installment, and the account identified in a
 * preamble rather than on the line. Period, branch and account number are
 * copied onto every row so a movement is self-describing without a second
 * lookup.
 *
 * `amount` follows this statement's own convention — positive is money in,
 * negative money out — which is the opposite of the card's. That is deliberate:
 * a charge on a card and cash leaving an account are different facts, and the
 * promotion step needs to tell them apart.
 */
export const accountMovements = pgTable(
  "account_movements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    institutionId: integer("institution_id").notNull(),
    /** See `cardMovements.accountId` — stated at import, not derived. */
    accountId: integer("account_id").notNull(),
    source: text("source").notNull(),
    key: text("key").notNull(),
    occurrence: integer("occurrence").notNull(),
    /*
     * The date the statement puts on the line. Named as the card's is, because
     * the two tables now carry one shape — but they do not mean the same
     * thing, and the difference is load-bearing: an account statement dates
     * money moving, an invoice dates the purchase, and an instalment bought in
     * April sits on a September bill. That is why the daily cash series is
     * built from account statements only.
     */
    purchaseDate: date("purchase_date", { mode: "date" }).notNull(),
    /** From the statement preamble, repeated on every row. */
    branch: text("branch"),
    accountNumber: text("account_number"),
    /** The institution's own category, verbatim. Never a Lastro category. */
    category: text("category"),
    /** The institution's own heading for the line, verbatim. Evidence only. */
    title: text("title"),
    description: text("description").notNull(),
    /** See `cardMovements.descriptorKey` — same rule, same reason. */
    descriptorKey: text("descriptor_key").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").default("BRL").notNull(),
    status: text("status").default("PENDING").notNull(),
    expenseId: integer("expense_id"),
    /** See `cardMovements.revenueId`. */
    revenueId: integer("revenue_id"),
    /** See `cardMovements.transferId`. */
    transferId: integer("transfer_id"),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "account_movements_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    dedupUnique: uniqueIndex("account_movements_book_id_key_occurrence_uk").on(
      table.bookId,
      table.key,
      table.occurrence,
    ),
    statusIdx: index("account_movements_book_id_status_idx").on(
      table.bookId,
      table.status,
    ),
    purchaseDateIdx: index("account_movements_book_id_purchase_date_idx").on(
      table.bookId,
      table.purchaseDate,
    ),
    bookForeignKey: foreignKey({
      name: "account_movements_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    institutionForeignKey: foreignKey({
      name: "account_movements_book_id_institution_id_fk",
      columns: [table.bookId, table.institutionId],
      foreignColumns: [institutions.bookId, institutions.id],
    }),
    accountForeignKey: foreignKey({
      name: "account_movements_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    expenseForeignKey: foreignKey({
      name: "account_movements_book_id_expense_id_fk",
      columns: [table.bookId, table.expenseId],
      foreignColumns: [expenses.bookId, expenses.id],
    }),
    revenueForeignKey: foreignKey({
      name: "account_movements_book_id_revenue_id_fk",
      columns: [table.bookId, table.revenueId],
      foreignColumns: [revenues.bookId, revenues.id],
    }),
    transferForeignKey: foreignKey({
      name: "account_movements_book_id_transfer_id_fk",
      columns: [table.bookId, table.transferId],
      foreignColumns: [transfers.bookId, transfers.id],
    }),
    /** See `cardMovements.descriptorForeignKey`. */
    descriptorForeignKey: foreignKey({
      name: "account_movements_book_id_descriptor_key_fk",
      columns: [table.bookId, table.accountId, table.descriptorKey],
      foreignColumns: [
        accountDescriptors.bookId,
        accountDescriptors.accountId,
        accountDescriptors.key,
      ],
    }),
    descriptorIdx: index("account_movements_book_id_descriptor_idx").on(
      table.bookId,
      table.accountId,
      table.descriptorKey,
    ),
    statusCheck: check(
      "account_movements_status_check",
      sql`${table.status} in ('PENDING', 'IGNORED', 'POSTED')`,
    ),
    /** See `cardMovements.postedLinkCheck`. */
    postedLinkCheck: check(
      "account_movements_posted_link_check",
      sql`(${table.status} = 'POSTED') = ((${table.expenseId} is not null)::int + (${table.revenueId} is not null)::int + (${table.transferId} is not null)::int = 1)`,
    ),
    occurrenceCheck: check(
      "account_movements_occurrence_check",
      sql`${table.occurrence} >= 1`,
    ),
  }),
);
