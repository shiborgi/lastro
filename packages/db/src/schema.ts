import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
      name: "book_members_user_id_users_id_fk",
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    roleCheck: check(
      "book_members_role_check",
      sql`${table.role} in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')`,
    ),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "accounts_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "accounts_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

export const parties = pgTable(
  "parties",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "parties_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "parties_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "expense_categories_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "expense_categories_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

export const revenueCategories = pgTable(
  "revenue_categories",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "revenue_categories_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "revenue_categories_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
  }),
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    accountId: integer("account_id").notNull(),
    partyId: integer("party_id").notNull(),
    expenseCategoryId: integer("expense_category_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "expenses_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    bookForeignKey: foreignKey({
      name: "expenses_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    accountForeignKey: foreignKey({
      name: "expenses_book_id_account_id_fk",
      columns: [table.bookId, table.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    partyForeignKey: foreignKey({
      name: "expenses_book_id_party_id_fk",
      columns: [table.bookId, table.partyId],
      foreignColumns: [parties.bookId, parties.id],
    }),
    categoryForeignKey: foreignKey({
      name: "expenses_book_id_expense_category_id_fk",
      columns: [table.bookId, table.expenseCategoryId],
      foreignColumns: [expenseCategories.bookId, expenseCategories.id],
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

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userForeignKey: foreignKey({
      name: "sessions_user_id_users_id_fk",
      columns: [table.userId],
      foreignColumns: [users.id],
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
