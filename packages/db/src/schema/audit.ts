/**
 * The append-only audit trail, the idempotency ledger every write consults,
 * and the agent credentials an MCP caller presents.
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
import { bookMembers, books } from "./books";

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

/**
 * One line of a card statement, staged before anything becomes an economic fact.
 *
 * ADR 8: an import never silently infers an expense. A statement line is a claim
 * about a cash movement, and turning it into an expense is a judgement — a
 * refund is not a purchase, an installment is not the whole price, and the line
 * that pays last month's bill is not a cost at all. So the import lands here,
 * someone reviews, and only then is an expense created and linked through
 * `expense_id`.
 *
 * Deduplication is `(book_id, key, occurrence)`. `key` hashes the institution,
 * the account, the purchase date, the descriptor the description normalises
 * to, and the amount — the fields a real-time notification and the eventual
 * statement line can both be expected to agree on — and `occurrence` counts
 * identical rows within one imported file. Both parts
 * are load-bearing: without the hash, re-importing doubles every row; without
 * the occurrence, two genuinely identical charges on one day (two R$12 purchases
 * at the same shop, present in the real file) collapse into one and a real
 * charge disappears with no warning.
 *
 * `amount` keeps the statement's own sign: positive is a charge, negative a
 * credit or a bill payment. `account_movements` uses the opposite convention
 * because its source does, and flattening the two would hide that money spent
 * on a card and money leaving an account are different facts.
 */
