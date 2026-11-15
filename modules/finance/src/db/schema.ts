/**
 * Finance's tables: the reference catalogs (institutions, accounts and their
 * billing windows, parties, categories) and the financial records built on
 * them (expenses, payments, revenues, receipts, their settlements, transfers).
 *
 * Exactly four financial records and two settlement links (ADR 2). Every
 * table is scoped by `books` through a composite key, so a reference can
 * never cross Books (ADR 3). Nothing here references a table of a module
 * that depends on finance (ADR 11, ADR 11).
 */
import { books } from "@lastro/core/db";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSequence,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const institutions = pgTable(
  "institutions",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "institutions_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("institutions_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    bookForeignKey: foreignKey({
      name: "institutions_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    institutionId: integer("institution_id"),
    /*
     * The number the institution prints: "123456789" for a checking account,
     * the last four digits for a card. Together with the institution it is what
     * identifies an account in the outside world, and it is how a statement
     * line finds the account it belongs to — the path names the institution and
     * the file names the number.
     */
    number: text("number"),
    name: text("name").notNull(),
    type: text("type").notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "accounts_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("accounts_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    /*
     * Four kinds, and a CHECK rather than free text. Every one is money the
     * Book controls: an acquirer or voucher operator that owes the Book is a
     * party with a role (`parties.role`), never an account. The type decides what a
     * movement against the account can mean — a CARD is settled by paying its
     * invoice, an ACCOUNT moves cash directly — so an unconstrained string here
     * would let a typo create a fifth kind nothing knows how to handle.
     */
    /*
     * One number per institution. Nulls do not collide, so an account without
     * a printed number (petty cash) is unconstrained while the ones a statement
     * can point at stay unambiguous.
     */
    numberUnique: uniqueIndex("accounts_book_institution_number_uk").on(
      table.bookId,
      table.institutionId,
      table.number,
    ),
    typeCheck: check(
      "accounts_type_check",
      sql`${table.type} in ('CARD', 'ACCOUNT', 'INVESTMENT', 'CASH')`,
    ),
    bookForeignKey: foreignKey({
      name: "accounts_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    institutionForeignKey: foreignKey({
      name: "accounts_book_id_institution_id_fk",
      columns: [table.bookId, table.institutionId],
      foreignColumns: [institutions.bookId, institutions.id],
    }),
  }),
);

/**
 * A card's billing cycle, one row per invoice.
 *
 * `reference_month` is the invoice; `starts_on` and `ends_on` are the window
 * of purchases it covers. Filled by hand, because no statement states it: an
 * invoice prints the purchases and their dates and never says which window
 * produced them, and the cycle boundary moves with weekends and holidays.
 *
 * `due_on` is the day that invoice is due: the card payment of the month is
 * due then (ADR 18).
 */
export const accountCycles = pgTable(
  "account_cycles",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    /** The invoice this window belongs to. Any day in it names the month. */
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    startsOn: date("starts_on", { mode: "date" }).notNull(),
    endsOn: date("ends_on", { mode: "date" }).notNull(),
    dueOn: date("due_on", { mode: "date" }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "account_cycles_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    accountMonthUnique: uniqueIndex("account_cycles_book_account_month_uk").on(
      table.bookId,
      table.accountId,
      table.referenceMonth,
    ),
    /** The lookup a purchase makes: which window holds this date. */
    windowIdx: index("account_cycles_book_account_window_idx").on(
      table.bookId,
      table.accountId,
      table.startsOn,
      table.endsOn,
    ),
    bookForeignKey: foreignKey({
      name: "account_cycles_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "account_cycles_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    orderCheck: check(
      "account_cycles_window_check",
      sql`${table.startsOn} <= ${table.endsOn} and ${table.endsOn} <= ${table.dueOn}`,
    ),
  }),
);

export const parties = pgTable(
  "parties",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "parties_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("parties_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    bookForeignKey: foreignKey({
      name: "parties_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

/**
 * The chart of accounts, two levels deep.
 *
 * A category may sit inside a group, and a group may not sit inside anything —
 * the depth is fixed rather than arbitrary, and that single decision removes
 * three problems at once. Cycles become impossible by construction, so no
 * cycle check is needed. Rolling up is a plain `group by parent_id` instead of
 * `WITH RECURSIVE`. And "is this node postable?" has one answer everywhere: a
 * group holds categories, a category holds records, never both.
 *
 * The rules a CHECK cannot express — a parent must itself be parentless, its
 * kind must match, and it must hold no records — live in `triggers.sql`,
 * alongside the settlement guards and for the same reason: the database is
 * where they hold for every caller.
 */
export const financialCategories = pgTable(
  "financial_categories",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    kind: text("kind").$type<"EXPENSE" | "REVENUE">().notNull(),
    name: text("name").notNull(),
    /** The group this sits inside. Null means it is a group, or stands alone. */
    parentId: integer("parent_id"),
    /**
     * How a result report treats expenses in this category (FIXED overhead,
     * MERCHANDISE cost of goods), or, for DEDUCTION, that its items are
     * negative: a discount or an acquirer's fee on a revenue, a discount on an expense
     * (ADR 6). Null for every category that takes no part in either.
     */
    role: text("role").$type<"FIXED" | "MERCHANDISE" | "DEDUCTION">(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "financial_categories_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "financial_categories_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    parentForeignKey: foreignKey({
      name: "financial_categories_book_id_parent_id_fk",
      columns: [table.bookId, table.parentId],
      foreignColumns: [table.bookId, table.id],
    }),
    parentIdx: index("financial_categories_book_id_parent_id_idx").on(
      table.bookId,
      table.parentId,
    ),
    kindCheck: check(
      "financial_categories_kind_check",
      sql`${table.kind} in ('EXPENSE', 'REVENUE')`,
    ),
    roleCheck: check(
      "financial_categories_role_check",
      // FIXED and MERCHANDISE are costs; only DEDUCTION reaches a revenue.
      sql`${table.role} is null or ${table.role} = 'DEDUCTION' or (${table.role} in ('FIXED', 'MERCHANDISE') and ${table.kind} = 'EXPENSE')`,
    ),
    // The one depth rule a CHECK can state: nothing is its own group.
    selfParentCheck: check(
      "financial_categories_self_parent_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  }),
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    partyId: integer("party_id").notNull(),
    financialCategoryId: integer("financial_category_id").notNull(),
    /*
     * A label for this specific debt, distinct from party and category: those
     * say who and what kind, never which one — "Assai Atacadista" plus
     * "Insumos" does not say which of a dozen trips this is. Nullable: a
     * record is often created before anyone gets around to naming it.
     */
    name: text("name"),
    amount: bigint("amount", { mode: "bigint" }).default(sql`0`).notNull(),
    currency: text("currency").default("USD").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    occurredOn: date("occurred_on", { mode: "date" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
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
    financialCategoryForeignKey: foreignKey({
      name: "expenses_book_id_financial_category_id_fk",
      columns: [table.bookId, table.financialCategoryId],
      foreignColumns: [financialCategories.bookId, financialCategories.id],
    }),
    /*
     * Signed, never zero (ADR 6): a discount obtained is a negative
     * expense. Which sign is allowed is the category's to say — negative
     * exactly in a DEDUCTION category — and that reads another row, so it is
     * `item_sign_matches_category` in triggers.sql.
     */
    amountCheck: check("expenses_amount_nonzero", sql`${table.amount} <> 0`),
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
     * carries — so the second purchase of September has to reach the same
     * payment as the first. The key is derived
     * (`card-<account>-<month>`) and unique, so two purchases in either order
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
    // This is a cache of the active settlements' signed total — a bill less
    // its discount. It is maintained by the settlement triggers and is never
    // supplied when creating a payment.
    amount: bigint("amount", { mode: "bigint" }).default(sql`0`).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    dueOn: date("due_on", { mode: "date" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidOn: date("paid_on", { mode: "date" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
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
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
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
    // Carries its expense's sign; `expense_settlement_within_total` says which.
    amountCheck: check(
      "expense_settlements_amount_nonzero",
      sql`${table.amount} <> 0`,
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
     * The stable handle that makes a revenue findable instead of duplicated.
     * Not nullable, unlike `receipts.key`: whoever recognizes a revenue derives
     * one, and a revenue entered by hand still needs one to stay addressable.
     */
    key: text("key").notNull(),
    partyId: integer("party_id").notNull(),
    financialCategoryId: integer("financial_category_id").notNull(),
    /** See `expenses.name`. */
    name: text("name"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    occurredOn: date("occurred_on", { mode: "date" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
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
    financialCategoryForeignKey: foreignKey({
      name: "revenues_book_id_financial_category_id_fk",
      columns: [table.bookId, table.financialCategoryId],
      foreignColumns: [financialCategories.bookId, financialCategories.id],
    }),
    /*
     * Signed, never zero (ADR 6): a discount or the acquirer's fee is a
     * negative revenue. The sign follows the category — negative exactly in a
     * DEDUCTION one (`item_sign_matches_category`). A derived amount never
     * walks down to zero either: voiding the last settlement leaves the
     * revenue at what it last earned (`refresh_revenue_amount`).
     */
    amountCheck: check("revenues_amount_nonzero", sql`${table.amount} <> 0`),
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
     * The stable handle that makes a receipt findable instead of duplicated.
     * Nullable: a receipt entered by hand needs none, and a unique index holds
     * many nulls.
     */
    key: text("key"),
    /*
     * How the money arrived. On a revenue this is PIX or TRANSFER and nothing
     * else: a card was how the *customer* paid, and what reaches the account
     * is the acquirer's deposit.
     */
    method: text("method"),
    /*
     * The signed total of the active settlements — a sale less the fee taken
     * from it, the net that reached the account. Maintained by
     * `refresh_receipt_amount` and never supplied: a receipt is created empty
     * and gains its amount as its settlements land, like a payment's.
     */
    amount: bigint("amount", { mode: "bigint" }).default(sql`0`).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    dueOn: date("due_on", { mode: "date" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidOn: date("paid_on", { mode: "date" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
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
     * Nonnegative: the amount is derived, it starts at zero and voiding every
     * settlement brings it back there. A deduction may never take it below,
     * checked row by row — which is why a writer settles the positive item
     * before its deduction and voids the deduction first (ADR 6).
     */
    amountCheck: check(
      "receipts_amount_nonnegative",
      sql`${table.amount} >= 0`,
    ),
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
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
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
    // Carries its revenue's sign; `revenue_settlement_within_total` says which.
    amountCheck: check(
      "revenue_settlements_amount_nonzero",
      sql`${table.amount} <> 0`,
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
    /** A label for this transfer, the same as `expenses.name`. */
    name: text("name"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    /** The day the statement says the money moved. See `expenses.occurredAt`
     * for why this sits beside `referenceMonth` rather than replacing it. */
    occurredOn: date("occurred_on", { mode: "date" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
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

/*
 * Account movement evidence (ADRs 13 and 17). Which importer reads an
 * account's content, the files finance took in, the movements they showed,
 * the descriptors that remember how a name is posted, and the links from a
 * movement to the records it became. Financial records never reference these
 * tables.
 */

const METHODS = sql.raw(
  "('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')",
);

/* One consumer per account and content type: the content says nothing about where it belongs. */
export const movementConsumers = pgTable(
  "movement_consumers",
  {
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    movementType: text("movement_type").notNull(),
    /** Opaque to finance: the id finance-imports registered the parser under. */
    importerId: text("importer_id").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "movement_consumers_pk",
      columns: [table.bookId, table.accountId, table.movementType],
    }),
    accountForeignKey: foreignKey({
      name: "movement_consumers_account_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    typeCheck: check(
      "movement_consumers_movement_type_check",
      sql`${table.movementType} ~ '^[a-z][a-z0-9-]{0,49}$' and length(${table.importerId}) > 0`,
    ),
  }),
);

export const movementFiles = pgTable(
  "movement_files",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    movementType: text("movement_type").notNull(),
    importerId: text("importer_id").notNull(),
    importerVersion: integer("importer_version").notNull(),
    importerFingerprint: text("importer_fingerprint").notNull(),
    contentSha256: text("content_sha256").notNull(),
    /** Provenance only: a key or path proves nothing about the money in the content. */
    sourceKey: text("source_key").notNull(),
    lineCount: integer("line_count").notNull(),
    newCount: integer("new_count").notNull(),
    importedBy: text("imported_by").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "movement_files_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    /* The same bytes read by the same importer into the same account are one intake. */
    contentUnique: uniqueIndex("movement_files_content_uk").on(
      table.bookId,
      table.accountId,
      table.importerFingerprint,
      table.contentSha256,
    ),
    accountForeignKey: foreignKey({
      name: "movement_files_account_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    countsCheck: check(
      "movement_files_counts_check",
      sql`${table.lineCount} > 0 and ${table.newCount} between 0 and ${table.lineCount} and ${table.importerVersion} > 0`,
    ),
    hashCheck: check(
      "movement_files_sha256_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$' and ${table.importerFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);

/* Payment and receipt movements share ids, so one `movementId` names either. */
export const accountMovementIds = pgSequence("account_movement_id_seq");

function descriptorTable(
  table: "payment_movement_descriptors" | "receipt_movement_descriptors",
) {
  return pgTable(
    table,
    {
      bookId: integer("book_id").notNull(),
      accountId: integer("account_id").notNull(),
      descriptorKey: text("descriptor_key").notNull(),
      /** The name as first seen. */
      name: text("name").notNull(),
      paymentMethod: text("payment_method"),
      partyId: integer("party_id"),
      financialCategoryId: integer("financial_category_id"),
      counterAccountId: integer("counter_account_id"),
      /*
       * Money in for sales already recognized (ADR 20): with a party and a
       * payment method and no financial category, a receipt movement posts a
       * receipt that settles the open sales of this group. Receipts only.
       */
      settlementGroup: text("settlement_group"),
    },
    (t) => ({
      primaryKey: primaryKey({
        name: `${table}_pk`,
        columns: [t.bookId, t.accountId, t.descriptorKey],
      }),
      accountForeignKey: foreignKey({
        name: `${table}_account_fk`,
        columns: [t.bookId, t.accountId],
        foreignColumns: [accounts.bookId, accounts.id],
      }),
      partyForeignKey: foreignKey({
        name: `${table}_party_fk`,
        columns: [t.bookId, t.partyId],
        foreignColumns: [parties.bookId, parties.id],
      }),
      categoryForeignKey: foreignKey({
        name: `${table}_financial_category_fk`,
        columns: [t.bookId, t.financialCategoryId],
        foreignColumns: [financialCategories.bookId, financialCategories.id],
      }),
      counterAccountForeignKey: foreignKey({
        name: `${table}_counter_account_fk`,
        columns: [t.bookId, t.counterAccountId],
        foreignColumns: [accounts.bookId, accounts.id],
      }),
      methodCheck: check(
        `${table}_payment_method_check`,
        sql`${t.paymentMethod} is null or ${t.paymentMethod} in ${METHODS}`,
      ),
      /* A transfer has no party or category. */
      mappingCheck: check(
        `${table}_mapping_check`,
        sql`${t.counterAccountId} is null or (${t.partyId} is null and ${t.financialCategoryId} is null and ${t.counterAccountId} <> ${t.accountId})`,
      ),
      settlementGroupCheck: check(
        `${table}_settlement_group_check`,
        table.startsWith("receipt")
          ? sql`${t.settlementGroup} is null or (${t.financialCategoryId} is null and ${t.counterAccountId} is null)`
          : sql`${t.settlementGroup} is null`,
      ),
    }),
  );
}

export const paymentMovementDescriptors = descriptorTable(
  "payment_movement_descriptors",
);
export const receiptMovementDescriptors = descriptorTable(
  "receipt_movement_descriptors",
);

function movementTable(table: "payment_movements" | "receipt_movements") {
  const descriptors =
    table === "payment_movements"
      ? paymentMovementDescriptors
      : receiptMovementDescriptors;
  return pgTable(
    table,
    {
      id: integer("id")
        .notNull()
        .default(sql`nextval('account_movement_id_seq')`),
      bookId: integer("book_id").notNull(),
      accountId: integer("account_id").notNull(),
      /** The file that first showed this line. */
      fileId: integer("file_id").notNull(),
      externalId: text("external_id").notNull(),
      occurredOn: date("occurred_on", { mode: "date" }).notNull(),
      occurredAt: timestamp("occurred_at", { withTimezone: true }),
      /** Positive; the table gives the direction. */
      amount: bigint("amount", { mode: "bigint" }).notNull(),
      currency: text("currency").notNull(),
      name: text("name").notNull(),
      descriptorKey: text("descriptor_key").notNull(),
      description: text("description").notNull(),
      paymentMethod: text("payment_method"),
      partyId: integer("party_id"),
      financialCategoryId: integer("financial_category_id"),
      counterAccountId: integer("counter_account_id"),
      /*
       * Money in for sales already recognized (ADR 20): with a party and a
       * payment method and no financial category, a receipt movement posts a
       * receipt that settles the open sales of this group. Receipts only.
       */
      settlementGroup: text("settlement_group"),
      /*
       * A promise of money, not the money (ADR 20): an acquirer's report of a
       * deposit. It posts an expected receipt; the bank line pays it.
       * Receipt movements only.
       */
      promise: boolean("promise").notNull().default(false),
      status: text("status").notNull().default("PENDING"),
      ignoreReason: text("ignore_reason"),
    },
    (t) => ({
      primaryKey: primaryKey({
        name: `${table}_book_id_id_pk`,
        columns: [t.bookId, t.id],
      }),
      /* A line is staged once per account, however many files repeat it. */
      externalUnique: uniqueIndex(`${table}_external_uk`).on(
        t.bookId,
        t.accountId,
        t.externalId,
      ),
      statusIdx: index(`${table}_status_idx`).on(t.bookId, t.status),
      accountForeignKey: foreignKey({
        name: `${table}_account_fk`,
        columns: [t.bookId, t.accountId],
        foreignColumns: [accounts.bookId, accounts.id],
      }),
      fileForeignKey: foreignKey({
        name: `${table}_file_fk`,
        columns: [t.bookId, t.fileId],
        foreignColumns: [movementFiles.bookId, movementFiles.id],
      }),
      descriptorForeignKey: foreignKey({
        name: `${table}_descriptor_fk`,
        columns: [t.bookId, t.accountId, t.descriptorKey],
        foreignColumns: [
          descriptors.bookId,
          descriptors.accountId,
          descriptors.descriptorKey,
        ],
      }),
      partyForeignKey: foreignKey({
        name: `${table}_party_fk`,
        columns: [t.bookId, t.partyId],
        foreignColumns: [parties.bookId, parties.id],
      }),
      categoryForeignKey: foreignKey({
        name: `${table}_financial_category_fk`,
        columns: [t.bookId, t.financialCategoryId],
        foreignColumns: [financialCategories.bookId, financialCategories.id],
      }),
      counterAccountForeignKey: foreignKey({
        name: `${table}_counter_account_fk`,
        columns: [t.bookId, t.counterAccountId],
        foreignColumns: [accounts.bookId, accounts.id],
      }),
      amountCheck: check(`${table}_amount_positive`, sql`${t.amount} > 0`),
      currencyCheck: check(
        `${table}_currency_check`,
        sql`${t.currency} ~ '^[A-Z]{3}$'`,
      ),
      methodCheck: check(
        `${table}_payment_method_check`,
        sql`${t.paymentMethod} is null or ${t.paymentMethod} in ${METHODS}`,
      ),
      /* POSTED is held against the links by a deferred trigger; IGNORED carries its reason. */
      statusCheck: check(
        `${table}_status_check`,
        sql`${t.status} in ('PENDING', 'POSTED', 'IGNORED') and (${t.status} = 'IGNORED') = (${t.ignoreReason} is not null)`,
      ),
      mappingCheck: check(
        `${table}_mapping_check`,
        sql`${t.counterAccountId} is null or (${t.partyId} is null and ${t.financialCategoryId} is null and ${t.counterAccountId} <> ${t.accountId})`,
      ),
      settlementGroupCheck: check(
        `${table}_settlement_group_check`,
        table.startsWith("receipt")
          ? sql`${t.settlementGroup} is null or (${t.financialCategoryId} is null and ${t.counterAccountId} is null)`
          : sql`${t.settlementGroup} is null`,
      ),
      promiseCheck: check(
        `${table}_promise_check`,
        table === "receipt_movements" ? sql`true` : sql`not ${t.promise}`,
      ),
    }),
  );
}

export const paymentMovements = movementTable("payment_movements");
export const receiptMovements = movementTable("receipt_movements");

/*
 * What a posted movement became (ADR 17). A link is a transfer, or an entry
 * (expense or revenue) with the cash record (payment or receipt) that
 * settled it. Its statement key is searchable: the other side of a transfer
 * finds the transfer through it.
 */
function linkTable(table: "payment_movement_links" | "receipt_movement_links") {
  const payment = table === "payment_movement_links";
  const movements = payment ? paymentMovements : receiptMovements;
  const entries = payment ? expenses : revenues;
  const cash = payment ? payments : receipts;
  const entry = payment ? "expense" : "revenue";
  const record = payment ? "payment" : "receipt";
  return pgTable(
    table,
    {
      id: serial("id").notNull(),
      bookId: integer("book_id").notNull(),
      movementId: integer("movement_id").notNull(),
      /** Shared by every record the movement became: its external id. */
      externalKey: text("external_key").notNull(),
      statementKey: text("statement_key").notNull(),
      amount: bigint("amount", { mode: "bigint" }).notNull(),
      transferId: integer("transfer_id"),
      entryId: integer(`${entry}_id`),
      /** `<external key>-<n>`: this expense (revenue) share. */
      entryKey: text(`${entry}_key`),
      cashId: integer(`${record}_id`),
      /** `<external key>-payment` (`-receipt`): the movement's one payment (receipt). */
      cashKey: text(`${record}_key`),
    },
    (t) => ({
      primaryKey: primaryKey({
        name: `${table}_book_id_id_pk`,
        columns: [t.bookId, t.id],
      }),
      statementKeyIdx: index(`${table}_statement_key_idx`).on(
        t.bookId,
        t.statementKey,
      ),
      movementIdx: index(`${table}_movement_idx`).on(t.bookId, t.movementId),
      externalKeyIdx: index(`${table}_external_key_idx`).on(
        t.bookId,
        t.externalKey,
      ),
      entryKeyUnique: uniqueIndex(`${table}_${entry}_key_uk`).on(
        t.bookId,
        t.entryKey,
      ),
      cashKeyIdx: index(`${table}_${record}_key_idx`).on(t.bookId, t.cashKey),
      movementForeignKey: foreignKey({
        name: `${table}_movement_fk`,
        columns: [t.bookId, t.movementId],
        foreignColumns: [movements.bookId, movements.id],
      }),
      transferForeignKey: foreignKey({
        name: `${table}_transfer_fk`,
        columns: [t.bookId, t.transferId],
        foreignColumns: [transfers.bookId, transfers.id],
      }),
      entryForeignKey: foreignKey({
        name: `${table}_${entry}_fk`,
        columns: [t.bookId, t.entryId],
        foreignColumns: [entries.bookId, entries.id],
      }),
      cashForeignKey: foreignKey({
        name: `${table}_${record}_fk`,
        columns: [t.bookId, t.cashId],
        foreignColumns: [cash.bookId, cash.id],
      }),
      amountCheck: check(`${table}_amount_positive`, sql`${t.amount} > 0`),
      targetCheck: check(
        `${table}_target_check`,
        sql`(${t.transferId} is not null and ${t.entryId} is null and ${t.cashId} is null and ${t.entryKey} is null and ${t.cashKey} is null)
          or (${t.transferId} is null and ${t.entryId} is not null and ${t.cashId} is not null and ${t.entryKey} is not null and ${t.cashKey} is not null)
          ${payment ? sql`` : sql`or (${t.transferId} is null and ${t.entryId} is null and ${t.entryKey} is null and ${t.cashId} is not null and ${t.cashKey} is not null)`}`,
      ),
      statementKeyCheck: check(
        `${table}_statement_key_check`,
        sql`${t.statementKey} ~ '^[ap][0-9]+-[A-Z_]+-[ap][0-9]+-[0-9]{8}-[0-9]+$'`,
      ),
    }),
  );
}

export const paymentMovementLinks = linkTable("payment_movement_links");
export const receiptMovementLinks = linkTable("receipt_movement_links");

/*
 * Card movement evidence (ADR 18). An invoice's lines, the descriptors that
 * classify a purchase name, and the two links a posted purchase leaves: its
 * expense, by expense key, and each instalment's invoice payment and
 * settlement, by payment key.
 */

export const cardMovementDescriptors = pgTable(
  "card_movement_descriptors",
  {
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    descriptorKey: text("descriptor_key").notNull(),
    /** The name as first seen. */
    name: text("name").notNull(),
    partyId: integer("party_id"),
    financialCategoryId: integer("financial_category_id"),
    /** The account the invoice is paid from: its lines are transfers into the card. */
    counterAccountId: integer("counter_account_id"),
    paymentMethod: text("payment_method"),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "card_movement_descriptors_pk",
      columns: [t.bookId, t.accountId, t.descriptorKey],
    }),
    accountForeignKey: foreignKey({
      name: "card_movement_descriptors_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    partyForeignKey: foreignKey({
      name: "card_movement_descriptors_party_fk",
      columns: [t.bookId, t.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "card_movement_descriptors_financial_category_fk",
      columns: [t.bookId, t.financialCategoryId],
      foreignColumns: [financialCategories.bookId, financialCategories.id],
    }),
    counterAccountForeignKey: foreignKey({
      name: "card_movement_descriptors_counter_account_fk",
      columns: [t.bookId, t.counterAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    methodCheck: check(
      "card_movement_descriptors_payment_method_check",
      sql`${t.paymentMethod} is null or ${t.paymentMethod} in ${METHODS}`,
    ),
    mappingCheck: check(
      "card_movement_descriptors_mapping_check",
      sql`${t.counterAccountId} is null or (${t.partyId} is null and ${t.financialCategoryId} is null and ${t.counterAccountId} <> ${t.accountId})`,
    ),
  }),
);

export const cardMovements = pgTable(
  "card_movements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    /** The file that first showed this line. */
    fileId: integer("file_id").notNull(),
    /** The sha256 of the line's text, `#<n>` for the n-th identical line of a file. */
    statementId: text("statement_id").notNull(),
    /** The sha256 of the line without its current instalment: the purchase. */
    externalId: text("external_id").notNull(),
    /** The payment statement key: `…-<instalment>/<count>`. */
    paymentKey: text("payment_key").notNull(),
    /** The expense statement key: `…-<count>`. */
    expenseKey: text("expense_key").notNull(),
    occurredOn: date("occurred_on", { mode: "date" }).notNull(),
    /** Signed: positive a charge, negative a credit. */
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    name: text("name").notNull(),
    descriptorKey: text("descriptor_key").notNull(),
    description: text("description").notNull(),
    cardholder: text("cardholder"),
    cardLast4: text("card_last4"),
    providerCategory: text("provider_category"),
    installmentNumber: integer("installment_number").notNull(),
    installmentCount: integer("installment_count").notNull(),
    partyId: integer("party_id"),
    financialCategoryId: integer("financial_category_id"),
    counterAccountId: integer("counter_account_id"),
    paymentMethod: text("payment_method"),
    status: text("status").notNull().default("PENDING"),
    ignoreReason: text("ignore_reason"),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "card_movements_book_id_id_pk",
      columns: [t.bookId, t.id],
    }),
    /* A line is staged once per card, however many files repeat it. */
    statementUnique: uniqueIndex("card_movements_statement_uk").on(
      t.bookId,
      t.accountId,
      t.statementId,
    ),
    externalIdx: index("card_movements_external_idx").on(
      t.bookId,
      t.accountId,
      t.externalId,
    ),
    /* One line per instalment. */
    paymentKeyUnique: uniqueIndex("card_movements_payment_key_uk").on(
      t.bookId,
      t.accountId,
      t.paymentKey,
    ),
    expenseKeyIdx: index("card_movements_expense_key_idx").on(
      t.bookId,
      t.accountId,
      t.expenseKey,
    ),
    statusIdx: index("card_movements_status_idx").on(t.bookId, t.status),
    accountForeignKey: foreignKey({
      name: "card_movements_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    fileForeignKey: foreignKey({
      name: "card_movements_file_fk",
      columns: [t.bookId, t.fileId],
      foreignColumns: [movementFiles.bookId, movementFiles.id],
    }),
    descriptorForeignKey: foreignKey({
      name: "card_movements_descriptor_fk",
      columns: [t.bookId, t.accountId, t.descriptorKey],
      foreignColumns: [
        cardMovementDescriptors.bookId,
        cardMovementDescriptors.accountId,
        cardMovementDescriptors.descriptorKey,
      ],
    }),
    partyForeignKey: foreignKey({
      name: "card_movements_party_fk",
      columns: [t.bookId, t.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "card_movements_financial_category_fk",
      columns: [t.bookId, t.financialCategoryId],
      foreignColumns: [financialCategories.bookId, financialCategories.id],
    }),
    counterAccountForeignKey: foreignKey({
      name: "card_movements_counter_account_fk",
      columns: [t.bookId, t.counterAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    methodCheck: check(
      "card_movements_payment_method_check",
      sql`${t.paymentMethod} is null or ${t.paymentMethod} in ${METHODS}`,
    ),
    mappingCheck: check(
      "card_movements_mapping_check",
      sql`${t.counterAccountId} is null or (${t.partyId} is null and ${t.financialCategoryId} is null and ${t.counterAccountId} <> ${t.accountId})`,
    ),
    amountCheck: check("card_movements_amount_check", sql`${t.amount} <> 0`),
    currencyCheck: check(
      "card_movements_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    installmentCheck: check(
      "card_movements_installment_check",
      sql`${t.installmentCount} >= 1 and ${t.installmentNumber} between 1 and ${t.installmentCount}`,
    ),
    /* POSTED is held against the payment link by a deferred trigger. */
    statusCheck: check(
      "card_movements_status_check",
      sql`${t.status} in ('PENDING', 'POSTED', 'IGNORED') and (${t.status} = 'IGNORED') = (${t.ignoreReason} is not null)`,
    ),
  }),
);

/* The expense a purchase became; one per card and expense key. */
export const cardMovementExpenses = pgTable(
  "card_movement_expenses",
  {
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    expenseKey: text("expense_key").notNull(),
    expenseId: integer("expense_id").notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "card_movement_expenses_pk",
      columns: [t.bookId, t.accountId, t.expenseKey],
    }),
    expenseUnique: uniqueIndex("card_movement_expenses_expense_uk").on(
      t.bookId,
      t.expenseId,
    ),
    accountForeignKey: foreignKey({
      name: "card_movement_expenses_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    expenseForeignKey: foreignKey({
      name: "card_movement_expenses_expense_fk",
      columns: [t.bookId, t.expenseId],
      foreignColumns: [expenses.bookId, expenses.id],
    }),
  }),
);

/* One instalment of a purchase: its invoice payment and settlement, and the line that showed it. */
export const cardMovementPayments = pgTable(
  "card_movement_payments",
  {
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    paymentKey: text("payment_key").notNull(),
    expenseKey: text("expense_key").notNull(),
    installmentNumber: integer("installment_number").notNull(),
    installmentCount: integer("installment_count").notNull(),
    paymentId: integer("payment_id").notNull(),
    settlementId: integer("settlement_id").notNull(),
    movementId: integer("movement_id"),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "card_movement_payments_pk",
      columns: [t.bookId, t.accountId, t.paymentKey],
    }),
    installmentUnique: uniqueIndex("card_movement_payments_installment_uk").on(
      t.bookId,
      t.accountId,
      t.expenseKey,
      t.installmentNumber,
    ),
    settlementUnique: uniqueIndex("card_movement_payments_settlement_uk").on(
      t.bookId,
      t.settlementId,
    ),
    expenseLinkForeignKey: foreignKey({
      name: "card_movement_payments_expense_link_fk",
      columns: [t.bookId, t.accountId, t.expenseKey],
      foreignColumns: [
        cardMovementExpenses.bookId,
        cardMovementExpenses.accountId,
        cardMovementExpenses.expenseKey,
      ],
    }),
    paymentForeignKey: foreignKey({
      name: "card_movement_payments_payment_fk",
      columns: [t.bookId, t.paymentId],
      foreignColumns: [payments.bookId, payments.id],
    }),
    settlementForeignKey: foreignKey({
      name: "card_movement_payments_settlement_fk",
      columns: [t.bookId, t.settlementId],
      foreignColumns: [expenseSettlements.bookId, expenseSettlements.id],
    }),
    movementForeignKey: foreignKey({
      name: "card_movement_payments_movement_fk",
      columns: [t.bookId, t.movementId],
      foreignColumns: [cardMovements.bookId, cardMovements.id],
    }),
    installmentCheck: check(
      "card_movement_payments_installment_check",
      sql`${t.installmentCount} >= 1 and ${t.installmentNumber} between 1 and ${t.installmentCount}`,
    ),
  }),
);

/* The transfer an invoice payment became; its key is how the account side finds it. */
export const cardMovementTransfers = pgTable(
  "card_movement_transfers",
  {
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    movementId: integer("movement_id").notNull(),
    /** The line's group: its external id. */
    externalKey: text("external_key").notNull(),
    statementKey: text("statement_key").notNull(),
    transferId: integer("transfer_id").notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "card_movement_transfers_pk",
      columns: [t.bookId, t.movementId],
    }),
    transferUnique: uniqueIndex("card_movement_transfers_transfer_uk").on(
      t.bookId,
      t.transferId,
    ),
    statementKeyIdx: index("card_movement_transfers_statement_key_idx").on(
      t.bookId,
      t.statementKey,
    ),
    externalKeyIdx: index("card_movement_transfers_external_key_idx").on(
      t.bookId,
      t.externalKey,
    ),
    movementForeignKey: foreignKey({
      name: "card_movement_transfers_movement_fk",
      columns: [t.bookId, t.movementId],
      foreignColumns: [cardMovements.bookId, cardMovements.id],
    }),
    accountForeignKey: foreignKey({
      name: "card_movement_transfers_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    transferForeignKey: foreignKey({
      name: "card_movement_transfers_transfer_fk",
      columns: [t.bookId, t.transferId],
      foreignColumns: [transfers.bookId, transfers.id],
    }),
    statementKeyCheck: check(
      "card_movement_transfers_statement_key_check",
      sql`${t.statementKey} ~ '^[ap][0-9]+-[A-Z_]+-[ap][0-9]+-[0-9]{8}-[0-9]+$'`,
    ),
  }),
);

/*
 * Revenue movement evidence (ADR 19): a point of sale's day by payment method.
 * Each record is up to three revenues (gross, discount, fee), each with its
 * own descriptor and link.
 */

export const revenueMovementDescriptors = pgTable(
  "revenue_movement_descriptors",
  {
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    /** `<method>_bruto`, `<method>_desconto` or `<method>_taxa`. */
    descriptorKey: text("descriptor_key").notNull(),
    component: text("component").notNull(),
    name: text("name").notNull(),
    partyId: integer("party_id"),
    financialCategoryId: integer("financial_category_id"),
    /*
     * Who pays the records of this descriptor (ADR 20). On an acquirer's
     * fee: the deposit group its records are paid in, and the point of
     * sale's method its gross settles. On a point of sale's gross: the
     * deposit group of an operator that pays them without a report of its
     * own (vouchers), or the account the money is received in on the day
     * (cash, the till).
     */
    settlementGroup: text("settlement_group"),
    settlesMethodKey: text("settles_method_key"),
    receivedAccountId: integer("received_account_id"),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "revenue_movement_descriptors_pk",
      columns: [t.bookId, t.accountId, t.descriptorKey],
    }),
    accountForeignKey: foreignKey({
      name: "revenue_movement_descriptors_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    partyForeignKey: foreignKey({
      name: "revenue_movement_descriptors_party_fk",
      columns: [t.bookId, t.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "revenue_movement_descriptors_financial_category_fk",
      columns: [t.bookId, t.financialCategoryId],
      foreignColumns: [financialCategories.bookId, financialCategories.id],
    }),
    componentCheck: check(
      "revenue_movement_descriptors_component_check",
      sql`${t.component} in ('GROSS', 'DISCOUNT', 'FEE', 'ACQUIRER_FEE')`,
    ),
    settlementCheck: check(
      "revenue_movement_descriptors_settlement_check",
      sql`case ${t.component}
        when 'ACQUIRER_FEE' then (${t.settlementGroup} is null) = (${t.settlesMethodKey} is null) and ${t.receivedAccountId} is null
        when 'GROSS' then ${t.settlesMethodKey} is null and (${t.settlementGroup} is null or ${t.receivedAccountId} is null)
        else ${t.settlementGroup} is null and ${t.settlesMethodKey} is null and ${t.receivedAccountId} is null end`,
    ),
    receivedAccountForeignKey: foreignKey({
      name: "revenue_movement_descriptors_received_account_fk",
      columns: [t.bookId, t.receivedAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
  }),
);

export const revenueMovements = pgTable(
  "revenue_movements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    fileId: integer("file_id").notNull(),
    /** The sha256 of the day, the method and the total paid. */
    externalId: text("external_id").notNull(),
    occurredOn: date("occurred_on", { mode: "date" }).notNull(),
    name: text("name").notNull(),
    methodKey: text("method_key").notNull(),
    quantity: integer("quantity").notNull(),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
    discount: bigint("discount", { mode: "bigint" }).notNull(),
    fee: bigint("fee", { mode: "bigint" }).notNull(),
    /** What the acquirer keeps (MDR, anticipation). */
    acquirerFee: bigint("acquirer_fee", { mode: "bigint" }).notNull(),
    /**
     * Whether the gross is itself a revenue. An acquirer's gross is what the
     * point of sale already recognized as paid; only its fee is new.
     */
    grossRecognized: boolean("gross_recognized").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("PENDING"),
    ignoreReason: text("ignore_reason"),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "revenue_movements_book_id_id_pk",
      columns: [t.bookId, t.id],
    }),
    externalUnique: uniqueIndex("revenue_movements_external_uk").on(
      t.bookId,
      t.accountId,
      t.externalId,
    ),
    statusIdx: index("revenue_movements_status_idx").on(t.bookId, t.status),
    accountForeignKey: foreignKey({
      name: "revenue_movements_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    fileForeignKey: foreignKey({
      name: "revenue_movements_file_fk",
      columns: [t.bookId, t.fileId],
      foreignColumns: [movementFiles.bookId, movementFiles.id],
    }),
    /* What will be received is the gross, less the discount, plus the fee, less the acquirer's fee. */
    amountsCheck: check(
      "revenue_movements_amounts_check",
      sql`${t.gross} > 0 and ${t.discount} >= 0 and ${t.fee} >= 0 and ${t.acquirerFee} >= 0 and ${t.quantity} >= 0 and ${t.amount} = ${t.gross} - ${t.discount} + ${t.fee} - ${t.acquirerFee}`,
    ),
    currencyCheck: check(
      "revenue_movements_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    statusCheck: check(
      "revenue_movements_status_check",
      sql`${t.status} in ('PENDING', 'POSTED', 'IGNORED') and (${t.status} = 'IGNORED') = (${t.ignoreReason} is not null)`,
    ),
  }),
);

/* One revenue a record became, per component. */
export const revenueMovementLinks = pgTable(
  "revenue_movement_links",
  {
    bookId: integer("book_id").notNull(),
    movementId: integer("movement_id").notNull(),
    component: text("component").notNull(),
    /** Shared by the record's revenues: the record's external id. */
    externalKey: text("external_key").notNull(),
    /** The sha256 of the external id, the component and the item's amount. */
    statementId: text("statement_id").notNull(),
    /** This revenue's key: `<external key>-<bruto|desconto|taxa>`. */
    revenueKey: text("revenue_key").notNull(),
    revenueId: integer("revenue_id").notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "revenue_movement_links_pk",
      columns: [t.bookId, t.movementId, t.component],
    }),
    revenueUnique: uniqueIndex("revenue_movement_links_revenue_uk").on(
      t.bookId,
      t.revenueId,
    ),
    externalKeyIdx: index("revenue_movement_links_external_key_idx").on(
      t.bookId,
      t.externalKey,
    ),
    statementUnique: uniqueIndex("revenue_movement_links_statement_uk").on(
      t.bookId,
      t.statementId,
    ),
    revenueKeyUnique: uniqueIndex("revenue_movement_links_revenue_key_uk").on(
      t.bookId,
      t.revenueKey,
    ),
    movementForeignKey: foreignKey({
      name: "revenue_movement_links_movement_fk",
      columns: [t.bookId, t.movementId],
      foreignColumns: [revenueMovements.bookId, revenueMovements.id],
    }),
    revenueForeignKey: foreignKey({
      name: "revenue_movement_links_revenue_fk",
      columns: [t.bookId, t.revenueId],
      foreignColumns: [revenues.bookId, revenues.id],
    }),
    componentCheck: check(
      "revenue_movement_links_component_check",
      sql`${t.component} in ('GROSS', 'DISCOUNT', 'FEE', 'ACQUIRER_FEE')`,
    ),
  }),
);

/*
 * Which receipts collected a record (ADR 20): an acquirer's record is paid by
 * one deposit; a point of sale's record by an operator's deposits, in parts,
 * or by its own receipt in the till (`own`, cash).
 */
export const revenueMovementReceipts = pgTable(
  "revenue_movement_receipts",
  {
    bookId: integer("book_id").notNull(),
    movementId: integer("movement_id").notNull(),
    receiptId: integer("receipt_id").notNull(),
    /** The record's own receipt, made when it posted (cash in the till). */
    own: boolean("own").notNull().default(false),
  },
  (t) => ({
    primaryKey: primaryKey({
      name: "revenue_movement_receipts_pk",
      columns: [t.bookId, t.movementId, t.receiptId],
    }),
    receiptIdx: index("revenue_movement_receipts_receipt_idx").on(
      t.bookId,
      t.receiptId,
    ),
    movementForeignKey: foreignKey({
      name: "revenue_movement_receipts_movement_fk",
      columns: [t.bookId, t.movementId],
      foreignColumns: [revenueMovements.bookId, revenueMovements.id],
    }),
    receiptForeignKey: foreignKey({
      name: "revenue_movement_receipts_receipt_fk",
      columns: [t.bookId, t.receiptId],
      foreignColumns: [receipts.bookId, receipts.id],
    }),
  }),
);
