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

/*
 * Better Auth owns human identity: the four tables below match the shape its
 * Drizzle adapter expects (model names `user`, `session`, `account`,
 * `verification`). Agent identity is separate and lives in `agentCredentials`
 * further down — Better Auth has no concept of a principal acting on behalf of
 * an operator, which is exactly what the MCP audit trail needs.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const books = pgTable("books", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bookMembers = pgTable(
  "book_members",
  {
    bookId: integer("book_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "book_members_book_id_user_id_pk",
      columns: [table.bookId, table.userId],
    }),
    bookForeignKey: foreignKey({
      name: "book_members_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    userForeignKey: foreignKey({
      name: "book_members_user_id_user_id_fk",
      columns: [table.userId],
      foreignColumns: [user.id],
    }),
    roleCheck: check(
      "book_members_role_check",
      sql`${table.role} in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')`,
    ),
  }),
);

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

export const accountDates = pgTable(
  "account_dates",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
    closeDate: timestamp("close_date").notNull(),
    dueDate: timestamp("due_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "account_dates_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    accountMonthUnique: uniqueIndex("account_dates_book_account_month_uk").on(
      table.bookId,
      table.accountId,
      table.referenceMonth,
    ),
    referenceMonthIdx: index("account_dates_book_id_reference_month_idx").on(
      table.bookId,
      table.referenceMonth,
    ),
    bookForeignKey: foreignKey({
      name: "account_dates_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "account_dates_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
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

export const partyAlias = pgTable(
  "party_alias",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    key: text("key").notNull(),
    partyId: integer("party_id"),
    categoryId: integer("category_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "party_alias_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("party_alias_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    bookForeignKey: foreignKey({
      name: "party_alias_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "party_alias_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    partyForeignKey: foreignKey({
      name: "party_alias_book_id_party_id_fk",
      columns: [table.bookId, table.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "party_alias_book_id_category_id_fk",
      columns: [table.bookId, table.categoryId],
      foreignColumns: [categories.bookId, categories.id],
    }),
  }),
);

export const categories = pgTable(
  "categories",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    kind: text("kind").$type<"EXPENSE" | "REVENUE">().notNull(),
    name: text("name").notNull(),
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
    kindCheck: check(
      "categories_kind_check",
      sql`${table.kind} in ('EXPENSE', 'REVENUE')`,
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
    categoryId: integer("category_id").notNull(),
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
    key: text("key").notNull(),
    partyId: integer("party_id").notNull(),
    categoryId: integer("category_id").notNull(),
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
    amountCheck: check("revenues_amount_positive", sql`${table.amount} > 0`),
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
    amountCheck: check("receipts_amount_positive", sql`${table.amount} > 0`),
    currencyCheck: check(
      "receipts_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
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
    correlationId: text("correlation_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    referenceMonth: date("reference_month", { mode: "date" }).notNull(),
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

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "idempotency_records_book_id_key_pk",
      columns: [table.bookId, table.key],
    }),
    bookForeignKey: foreignKey({
      name: "idempotency_records_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

export const agentCredentials = pgTable(
  "agent_credentials",
  {
    id: text("id").primaryKey(),
    bookId: integer("book_id").notNull(),
    principal: text("principal").notNull(),
    delegatedOperator: text("delegated_operator").notNull(),
    secretHash: text("secret_hash").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    bookForeignKey: foreignKey({
      name: "agent_credentials_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    operatorForeignKey: foreignKey({
      name: "agent_credentials_book_id_operator_fk",
      columns: [table.bookId, table.delegatedOperator],
      foreignColumns: [bookMembers.bookId, bookMembers.userId],
    }),
  }),
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    actorType: text("actor_type").notNull(),
    actorPrincipal: text("actor_principal").notNull(),
    delegatedOperator: text("delegated_operator").notNull(),
    bookId: integer("book_id").notNull(),
    source: text("source").notNull(),
    correlationId: text("correlation_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    bookForeignKey: foreignKey({
      name: "audit_events_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    actorTypeCheck: check(
      "audit_events_actor_type_check",
      sql`${table.actorType} in ('USER', 'ASSISTANT', 'SYSTEM')`,
    ),
    sourceCheck: check(
      "audit_events_source_check",
      sql`${table.source} in ('WEB', 'API', 'MCP', 'WORKER')`,
    ),
  }),
);
