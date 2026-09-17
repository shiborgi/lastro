/**
 * The tenancy root and its membership.
 *
 * A Book is the mandatory scope for every financial record (ADR 4). Composite
 * keys downstream carry `book_id` so tenancy is enforced at the database
 * boundary rather than by remembering a WHERE clause.
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
import { user } from "./auth";

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
