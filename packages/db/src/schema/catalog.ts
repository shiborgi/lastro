/**
 * What a Book names before it can record money: institutions, accounts and
 * their billing windows, parties, the statement descriptors that map a line's
 * text onto them, and the chart of accounts.
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
import { expenses, revenues, transfers } from "./financial";

export const institutions = pgTable(
  "institutions",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
     * The number the institution prints: "295076852" for a checking account,
     * the last four digits for a card. Together with the institution it is what
     * identifies an account in the outside world, and it is how a statement
     * line finds the account it belongs to — the path names the institution and
     * the file names the number.
     */
    number: text("number"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
     * Four kinds, and a CHECK rather than free text. The type decides what a
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
 * `reference_month` is the invoice; `start_date` and `end_date` are the window
 * of purchases it covers. Filled by hand, because no statement states it: the
 * C6 invoice prints the purchases and their dates and never says which window
 * produced them, and the cycle boundary moves with weekends and holidays.
 *
 * This replaced `account_dates`, which held `close_date` and `due_date` for the
 * same (account, month) and had no callers, no rows, and no way in — a second
 * table for one concept, where the concept is "which invoice does a purchase
 * land on". The due date is not stored: promotion derives it from the cycle a
 * purchase falls in and then steps monthly, so a stored copy could disagree.
 */
export const accountReferenceMonths = pgTable(
  "account_reference_month",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    /** The invoice this window belongs to. Any day in it names the month. */
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    startDate: date("start_date", { mode: "date" }).notNull(),
    endDate: date("end_date", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "account_reference_month_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    accountMonthUnique: uniqueIndex(
      "account_reference_month_book_account_month_uk",
    ).on(table.bookId, table.accountId, table.referenceMonth),
    /** The lookup promotion makes: which window holds this purchase date. */
    windowIdx: index("account_reference_month_book_account_window_idx").on(
      table.bookId,
      table.accountId,
      table.startDate,
      table.endDate,
    ),
    bookForeignKey: foreignKey({
      name: "account_reference_month_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "account_reference_month_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    orderCheck: check(
      "account_reference_month_window_check",
      sql`${table.startDate} <= ${table.endDate}`,
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
 * Descriptors: what a statement printed, mapped to what the books should do
 * with it. One row stands for every line that shares that wording, so deciding
 * `papon_mini_-_mercado_e` once resolves twenty-one movements.
 *
 * There are two tables, one per statement kind, and they are deliberately not
 * the same shape. A single shared table was the first design, and the data says
 * it was never shared: of sixty-nine descriptors, twenty-six occur only on card
 * invoices and forty-three only on account statements — **none on both**. The
 * keys are computed from different fields by different plugins, so a collision
 * would be a coincidence rather than a match, and a shared table meant every
 * card row carried two columns that can only ever be null.
 *
 * `key` is the normalised form of what the institution printed. It is never
 * updatable: renaming it makes the next import recompute the original, create a
 * second descriptor, and quietly stop applying this mapping.
 *
 * The card side carries a party and a category and nothing else. It needs no
 * method — every line on a credit-card invoice was paid by that card — and no
 * kind: an invoice line is a charge, so it becomes an expense. The one credit
 * measured across 54 rows was "Pag Fatura Boleto", the bill being paid, which
 * is not income and is already recorded on the account statement; promotion
 * refuses it rather than inflating a month's revenue by the size of the bill.
 */
export const cardDescriptors = pgTable(
  "card_descriptors",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    /*
     * Which account's statement this descriptor came from. A descriptor is
     * per account, not per Book: the same wording on two different cards is
     * two counterparties as often as it is one, and merging them attributes
     * one account's spending to the other. It also makes the mapping
     * transferable — reviewing the C6 card teaches nothing about the Nubank
     * card, which is the honest position.
     */
    accountId: integer("account_id").notNull(),
    key: text("key").notNull(),
    partyId: integer("party_id"),
    categoryId: integer("category_id"),
    /*
     * A label for the expense this descriptor promotes to — never seeded from
     * the statement, the same rule that already governs party and category:
     * the bank's own wording is evidence for a person to read, not a name to
     * adopt. Left null until an operator sets it, same as party and category,
     * and copied onto `expenses.name` at promotion.
     */
    name: text("name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "card_descriptors_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    /*
     * A UNIQUE constraint, not a unique index: `card_movements` carries a
     * foreign key to `(book_id, key)`, and Postgres only accepts a constraint
     * as an FK target. A bare `CREATE UNIQUE INDEX` enforces the same rule but
     * cannot be referenced.
     */
    keyUnique: unique("card_descriptors_book_id_account_id_key_uk").on(
      table.bookId,
      table.accountId,
      table.key,
    ),
    accountForeignKey: foreignKey({
      name: "card_descriptors_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    bookForeignKey: foreignKey({
      name: "card_descriptors_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    partyForeignKey: foreignKey({
      name: "card_descriptors_book_id_party_id_fk",
      columns: [table.bookId, table.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "card_descriptors_book_id_category_id_fk",
      columns: [table.bookId, table.categoryId],
      foreignColumns: [categories.bookId, categories.id],
    }),
  }),
);

/**
 * The account-statement side. See `cardDescriptors` for why there are two.
 *
 * This is the side that carries a method and a transfer destination, because
 * this is the side where they vary: the measured statements produced Pix,
 * boleto, debit card, credit card and bare transfers across forty-three
 * descriptors, while every card descriptor but one inferred CREDIT_CARD.
 */
export const accountDescriptors = pgTable(
  "account_descriptors",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    /*
     * Which account's statement this descriptor came from. A descriptor is
     * per account, not per Book: the same wording on two different cards is
     * two counterparties as often as it is one, and merging them attributes
     * one account's spending to the other. It also makes the mapping
     * transferable — reviewing the C6 card teaches nothing about the Nubank
     * card, which is the honest position.
     */
    accountId: integer("account_id").notNull(),
    key: text("key").notNull(),
    partyId: integer("party_id"),
    categoryId: integer("category_id"),
    /*
     * Which rail the money took, filled by the import's own inference and
     * editable afterwards. It lives here rather than in a table of its own
     * because on every statement measured so far the descriptor that names the
     * counterparty is the one that names the rail — none produced a descriptor
     * needing two different methods.
     */
    method: text("method"),
    /*
     * The other side of a transfer — and, by being set at all, the declaration
     * that this *is* one.
     *
     * The sign tells direction, money out or in, but it can never reveal that
     * a Pix to yourself is your own money moving between two of your accounts:
     * `pix_enviado_para_gelagoela` and `pix_enviado_para_nutricao_em_foco` are
     * the same text, the same direction and the same shape of amount, and one
     * is a transfer while the other pays a supplier. Only a person knows.
     *
     * A `kind` column used to carry that declaration beside this one. It was
     * redundant: EXPENSE and REVENUE had to agree with the sign or promotion
     * refused them, so the only value that changed anything was TRANSFER — and
     * a transfer cannot be promoted without a destination anyway. Pointing at
     * the account is the whole declaration.
     */
    counterAccountId: integer("counter_account_id"),
    /** See `cardDescriptors.name` — copied onto `expenses.name` or
     * `revenues.name` at promotion, never onto a transfer. */
    name: text("name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "account_descriptors_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    /** See `cardDescriptors.keyUnique` — constraint, not index, same reason. */
    keyUnique: unique("account_descriptors_book_id_account_id_key_uk").on(
      table.bookId,
      table.accountId,
      table.key,
    ),
    accountForeignKey: foreignKey({
      name: "account_descriptors_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    bookForeignKey: foreignKey({
      name: "account_descriptors_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    partyForeignKey: foreignKey({
      name: "account_descriptors_book_id_party_id_fk",
      columns: [table.bookId, table.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "account_descriptors_book_id_category_id_fk",
      columns: [table.bookId, table.categoryId],
      foreignColumns: [categories.bookId, categories.id],
    }),
    counterAccountForeignKey: foreignKey({
      name: "account_descriptors_book_id_counter_account_id_fk",
      columns: [table.bookId, table.counterAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    methodCheck: check(
      "account_descriptors_method_check",
      sql`${table.method} is null or ${table.method} in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')`,
    ),
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
export const categories = pgTable(
  "categories",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    kind: text("kind").$type<"EXPENSE" | "REVENUE">().notNull(),
    name: text("name").notNull(),
    /** The group this sits inside. Null means it is a group, or stands alone. */
    parentId: integer("parent_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "categories_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "categories_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    parentForeignKey: foreignKey({
      name: "categories_book_id_parent_id_fk",
      columns: [table.bookId, table.parentId],
      foreignColumns: [table.bookId, table.id],
    }),
    parentIdx: index("categories_book_id_parent_id_idx").on(
      table.bookId,
      table.parentId,
    ),
    kindCheck: check(
      "categories_kind_check",
      sql`${table.kind} in ('EXPENSE', 'REVENUE')`,
    ),
    // The one depth rule a CHECK can state: nothing is its own group.
    selfParentCheck: check(
      "categories_self_parent_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  }),
);
