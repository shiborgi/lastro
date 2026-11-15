/**
 * Core's tables: human identity, the tenancy root and its membership, agent
 * credentials, the audit trail and the idempotency ledger.
 *
 * No table here references a table of another module: every other module
 * scopes its records by `books`, never the reverse (ADR 11).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/*
 * Better Auth owns human identity: the four tables below match the shape its
 * Drizzle adapter expects. Its model names (`user`, `session`, `account`,
 * `verification`) map to these `auth_` tables in apps/api/src/auth.ts, so no
 * table is singular and `auth_accounts` (sign-in methods) cannot be read as
 * finance's `accounts`.
 * Agent identity is separate and lives in `agent_credentials`: Better Auth
 * has no concept of a principal acting on behalf of an operator.
 */
export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
});

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
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

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/*
 * A Book is the mandatory scope for every business record (ADR 3). Composite
 * keys downstream carry `book_id`, so tenancy is enforced at the database
 * boundary and not by remembering a WHERE clause.
 */
export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    /*
     * The stable, human-chosen handle. A Book is the root, so its key is
     * unique across the whole database.
     */
    key: text("key").notNull(),
    name: text("name").notNull(),
  },
  (table) => ({
    keyUnique: uniqueIndex("books_key_uk").on(table.key),
  }),
);

export const bookMembers = pgTable(
  "book_members",
  {
    bookId: integer("book_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
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
      foreignColumns: [authUsers.id],
    }),
    roleCheck: check(
      "book_members_role_check",
      sql`${table.role} in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')`,
    ),
  }),
);

/*
 * An agent acts for one member of one Book. The composite key to
 * `book_members` is what makes its role the delegated operator's role,
 * resolved on every request: removing the member retires the credential.
 */
export const agentCredentials = pgTable(
  "agent_credentials",
  {
    id: text("id").primaryKey(),
    bookId: integer("book_id").notNull(),
    principal: text("principal").notNull(),
    delegatedOperator: text("delegated_operator").notNull(),
    secretHash: text("secret_hash").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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

/* Append-only. The write envelope is its only writer. */
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
    /** The operation that ran, `<module>.<name>`. */
    operation: text("operation").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
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

/*
 * One row per idempotency key a write was made with. `result` is the wire
 * result the first call answered with; a replay answers with it again and
 * runs nothing.
 */
export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    result: jsonb("result").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
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
