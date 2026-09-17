/**
 * The four explicit financial records and the settlements that link them.
 *
 * There is no universal `transactions` table here and there should not be one
 * (ADR 2). Amounts a trigger derives — a payment's, a revenue's — are written
 * by ./triggers.sql, never by the application.
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
  categories,
  parties,
} from "./catalog";

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    partyId: integer("party_id").notNull(),
    categoryId: integer("category_id").notNull(),
    /*
     * A label for this specific debt, distinct from party and category: those
     * say who and what kind, never which one — "Assai Atacadista" plus
     * "Insumos" does not say which of a dozen trips this is. Nullable and
     * filled from the descriptor that promoted it (see `cardDescriptors.name`
     * / `accountDescriptors.name`), because promotion is the one place that
     * knows both the descriptor and the expense being created; nothing
     * upstream can require it without blocking every promotion made before an
     * operator gets around to naming the descriptor.
     */
    name: text("name"),
    amount: bigint("amount", { mode: "bigint" }).default(sql`0`).notNull(),
    currency: text("currency").default("USD").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "expenses_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    currencyKey: unique("expenses_book_id_id_currency_uk").on(
      table.bookId,
      table.id,
      table.currency,
    ),
    keyUnique: uniqueIndex("expenses_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    referenceMonthIdx: index("expenses_book_id_reference_month_idx").on(
      table.bookId,
      table.referenceMonth,
    ),
    bookForeignKey: foreignKey({
      name: "expenses_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    partyForeignKey: foreignKey({
      name: "expenses_book_id_party_id_fk",
      columns: [table.bookId, table.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "expenses_book_id_category_id_fk",
      columns: [table.bookId, table.categoryId],
      foreignColumns: [categories.bookId, categories.id],
    }),
  }),
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    /*
     * What makes a bill findable instead of duplicated.
     *
     * A credit card is paid once a month, however many purchases the invoice
     * carries — so promoting the second purchase of September has to reach the
     * same payment as the first. The key is derived
     * (`card-<account>-<month>`) and unique, so two promotions in either order
     * collide here rather than opening a second bill for one month.
     *
     * Nullable, because a payment made by hand needs no such handle and a
     * unique index holds many nulls.
     */
    key: text("key"),
    /*
     * How the money moved: PIX, BOLETO, TED or a card. Nullable because the
     * statement does not always say — a line reading only "VIVO - GVT" records
     * a supplier and no method, and an empty field is worth more than a
     * plausible guess. `account_id` says *where* it moved; this says *how*.
     */
    method: text("method"),
    // This is a cache of the active settlements' total. It is maintained by
    // the settlement triggers and is never supplied when creating a payment.
    amount: bigint("amount", { mode: "bigint" }).default(sql`0`).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    dueAt: timestamp("due_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "payments_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("payments_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    currencyKey: unique("payments_book_id_id_currency_uk").on(
      table.bookId,
      table.id,
      table.currency,
    ),
    referenceMonthIdx: index("payments_book_id_reference_month_idx").on(
      table.bookId,
      table.referenceMonth,
    ),
    bookForeignKey: foreignKey({
      name: "payments_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "payments_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    amountCheck: check(
      "payments_amount_nonnegative",
      sql`${table.amount} >= 0`,
    ),
    currencyCheck: check(
      "payments_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    methodCheck: check(
      "payments_method_check",
      sql`${table.method} is null or ${table.method} in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')`,
    ),
  }),
);

export const expenseSettlements = pgTable(
  "expense_settlements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    expenseId: integer("expense_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    installmentNumber: integer("installment_number").notNull(),
    installmentCount: integer("installment_count").notNull(),
    /*
     * What this allocation was, in the operator's own words.
     *
     * Free text and nullable: a settlement that needs no explanation is the
     * normal case. It exists for the ones that do — which instalment of a
     * renegotiation this is, why a receipt was split across two invoices —
     * where the amounts alone leave a later reader guessing.
     */
    description: text("description"),
    voidedAt: timestamp("voided_at"),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "expense_settlements_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "expense_settlements_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    expenseForeignKey: foreignKey({
      name: "expense_settlements_book_id_expense_id_fk",
      columns: [table.bookId, table.expenseId, table.currency],
      foreignColumns: [expenses.bookId, expenses.id, expenses.currency],
    }),
    paymentForeignKey: foreignKey({
      name: "expense_settlements_book_id_payment_id_fk",
      columns: [table.bookId, table.paymentId, table.currency],
      foreignColumns: [payments.bookId, payments.id, payments.currency],
    }),
    amountCheck: check(
      "expense_settlements_amount_positive",
      sql`${table.amount} > 0`,
    ),
    currencyCheck: check(
      "expense_settlements_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    installmentCheck: check(
      "expense_settlements_installment_check",
      sql`${table.installmentNumber} >= 1 and ${table.installmentCount} >= ${table.installmentNumber}`,
    ),
  }),
);

export const revenues = pgTable(
  "revenues",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    /*
     * What makes a day's earnings from one payer findable instead of
     * duplicated.
     *
     * An acquirer settles a day's sales in several lines — one per flag and
     * function — and they are one customer relationship's earnings for the
     * day, not several. So a revenue promoted from an account movement is
     * keyed per counterparty per day (`recv-<account>-<party>-<date>`), and
     * the second line of the day finds the first one's revenue.
     *
     * Not nullable, unlike `receipts.key`: a promotion always derives one —
     * from a movement (the case above) or from a card purchase
     * (`purchaseHashFor`) — and a revenue entered by hand still needs one to
     * stay addressable the same way.
     */
    key: text("key").notNull(),
    partyId: integer("party_id").notNull(),
    categoryId: integer("category_id").notNull(),
    /** See `expenses.name`. */
    name: text("name"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "revenues_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    currencyKey: unique("revenues_book_id_id_currency_uk").on(
      table.bookId,
      table.id,
      table.currency,
    ),
    keyUnique: uniqueIndex("revenues_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    referenceMonthIdx: index("revenues_book_id_reference_month_idx").on(
      table.bookId,
      table.referenceMonth,
    ),
    bookForeignKey: foreignKey({
      name: "revenues_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    partyForeignKey: foreignKey({
      name: "revenues_book_id_party_id_fk",
      columns: [table.bookId, table.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "revenues_book_id_category_id_fk",
      columns: [table.bookId, table.categoryId],
      foreignColumns: [categories.bookId, categories.id],
    }),
    /*
     * Nonnegative, not positive, for a revenue an account movement promoted:
     * the amount is derived from the settlements by a trigger, and voiding or
     * deleting the last one leaves zero. `> 0` stays right for a card
     * purchase or a revenue entered by hand, where the amount is fixed at
     * creation and never yet zero — but the constraint cannot tell those
     * apart from a derived one, so it has to allow the case that can happen.
     */
    amountCheck: check(
      "revenues_amount_nonnegative",
      sql`${table.amount} >= 0`,
    ),
    currencyCheck: check(
      "revenues_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  }),
);

export const receipts = pgTable(
  "receipts",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    /*
     * What makes re-promoting the same statement line a no-op instead of a
     * second deposit.
     *
     * One per movement, matching the bank statement exactly — an acquirer
     * settling a day's sales in six lines is six real deposits as far as the
     * bank is concerned, whatever they add up to for the payer. The revenue
     * those lines earn is where they get aggregated (`revenues.key`); the
     * receipt stays evidence, one row per line.
     *
     * Nullable, because a receipt entered by hand needs no such handle and a
     * unique index holds many nulls.
     */
    key: text("key"),
    /*
     * How the money arrived. On a revenue this is PIX or TRANSFER and nothing
     * else: a card was how the *customer* paid, and what reaches the account
     * is the acquirer's deposit.
     */
    method: text("method"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    dueAt: timestamp("due_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "receipts_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("receipts_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    currencyKey: unique("receipts_book_id_id_currency_uk").on(
      table.bookId,
      table.id,
      table.currency,
    ),
    referenceMonthIdx: index("receipts_book_id_reference_month_idx").on(
      table.bookId,
      table.referenceMonth,
    ),
    bookForeignKey: foreignKey({
      name: "receipts_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "receipts_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    /*
     * Positive again, not nonnegative: a receipt is no longer a sum a void
     * can walk down to zero (that risk moved to `revenues.amount`) — it is
     * this line's own figure, fixed once at creation, the same as an
     * expense's or a receipt entered by hand always was.
     */
    amountCheck: check("receipts_amount_positive", sql`${table.amount} > 0`),
    currencyCheck: check(
      "receipts_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    methodCheck: check(
      "receipts_method_check",
      sql`${table.method} is null or ${table.method} in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')`,
    ),
  }),
);

export const revenueSettlements = pgTable(
  "revenue_settlements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    revenueId: integer("revenue_id").notNull(),
    receiptId: integer("receipt_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    /*
     * What this allocation was, in the operator's own words.
     *
     * Free text and nullable: a settlement that needs no explanation is the
     * normal case. It exists for the ones that do — which instalment of a
     * renegotiation this is, why a receipt was split across two invoices —
     * where the amounts alone leave a later reader guessing.
     */
    description: text("description"),
    voidedAt: timestamp("voided_at"),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "revenue_settlements_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "revenue_settlements_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    revenueForeignKey: foreignKey({
      name: "revenue_settlements_book_id_revenue_id_fk",
      columns: [table.bookId, table.revenueId, table.currency],
      foreignColumns: [revenues.bookId, revenues.id, revenues.currency],
    }),
    receiptForeignKey: foreignKey({
      name: "revenue_settlements_book_id_receipt_id_fk",
      columns: [table.bookId, table.receiptId, table.currency],
      foreignColumns: [receipts.bookId, receipts.id, receipts.currency],
    }),
    amountCheck: check(
      "revenue_settlements_amount_positive",
      sql`${table.amount} > 0`,
    ),
    currencyCheck: check(
      "revenue_settlements_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  }),
);

export const transfers = pgTable(
  "transfers",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    sourceAccountId: integer("source_account_id").notNull(),
    destinationAccountId: integer("destination_account_id").notNull(),
    /**
     * A label for this transfer, the same as `expenses.name` — copied from
     * the account descriptor that promoted it, where that descriptor is the
     * transfer's own declaration (`counterAccountId` set). Nothing else on a
     * transfer names it: it has no party or category, only the two accounts,
     * and those already sit in their own columns.
     */
    name: text("name"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    /** The day the statement says the money moved. See `expenses.occurredAt`
     * for why this sits beside `referenceMonth` rather than replacing it. */
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "transfers_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("transfers_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    referenceMonthIdx: index("transfers_book_id_reference_month_idx").on(
      table.bookId,
      table.referenceMonth,
    ),
    bookForeignKey: foreignKey({
      name: "transfers_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    sourceForeignKey: foreignKey({
      name: "transfers_book_id_source_account_fk",
      columns: [table.bookId, table.sourceAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    destinationForeignKey: foreignKey({
      name: "transfers_book_id_destination_account_fk",
      columns: [table.bookId, table.destinationAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    amountCheck: check("transfers_amount_positive", sql`${table.amount} > 0`),
    currencyCheck: check(
      "transfers_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  }),
);
