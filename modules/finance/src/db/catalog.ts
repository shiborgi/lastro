/** The catalog tables' PostgreSQL adapter. */
import { type Db, idNumber } from "@lastro/core/db";
import { type SQL, and, asc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { CatalogPort, CatalogTable } from "../application/port";
import type {
  Account,
  AccountCycle,
  FinancialCategory,
  Institution,
  Party,
} from "../domain/catalog";
import * as schema from "./schema";

const text = (value: number | null): string | null =>
  value === null ? null : String(value);
const number = (value: string | null | undefined, field: string) =>
  value == null ? null : idNumber(value, field);

type Scoped = PgTable & { id: PgColumn; bookId: PgColumn };

/*
 * One catalog table: every query carries the Book, so a record of another
 * Book is simply not found. `toRow` maps only the fields it is given, which
 * is what lets one function serve insert and partial update.
 */
function catalogTable<T, Row, Filter>(config: {
  table: Scoped;
  fromRow(row: Row): T;
  toRow(fields: Partial<Omit<T, "id" | "bookId">>): Record<string, unknown>;
  where?(filter: Filter): SQL | undefined;
}): CatalogTable<T, Filter> {
  const { table, fromRow, toRow } = config;
  const one = (bookId: string, id: string) =>
    and(
      eq(table.bookId, idNumber(bookId, "bookId")),
      eq(table.id, idNumber(id)),
    );
  const on = (handle: unknown) => handle as Db;
  return {
    async list(handle, bookId, filter) {
      const rows = await on(handle)
        .select()
        .from(table)
        .where(
          and(
            eq(table.bookId, idNumber(bookId, "bookId")),
            filter ? config.where?.(filter) : undefined,
          ),
        )
        .orderBy(asc(table.id));
      return (rows as Row[]).map(fromRow);
    },
    async get(handle, bookId, id) {
      // An id that is not a number names no record.
      if (!/^\d+$/.test(id)) return null;
      const [row] = await on(handle)
        .select()
        .from(table)
        .where(one(bookId, id));
      return row ? fromRow(row as Row) : null;
    },
    async insert(handle, bookId, input) {
      const [row] = await on(handle)
        .insert(table)
        .values({ ...toRow(input), bookId: idNumber(bookId, "bookId") })
        .returning();
      if (!row) throw new Error("insert returned no row");
      return fromRow(row as Row);
    },
    async update(handle, bookId, id, patch) {
      if (!/^\d+$/.test(id)) return null;
      const values = toRow(patch);
      if (Object.keys(values).length === 0) return this.get(handle, bookId, id);
      const [row] = await on(handle)
        .update(table)
        .set(values)
        .where(one(bookId, id))
        .returning();
      return row ? fromRow(row as Row) : null;
    },
    async remove(handle, bookId, id) {
      if (!/^\d+$/.test(id)) return false;
      const rows = await on(handle)
        .delete(table)
        .where(one(bookId, id))
        .returning({ id: table.id });
      return rows.length > 0;
    },
  };
}

/** Copy the members of `fields` that are present, converting the named ids. */
function pick<T extends object>(
  fields: T,
  ids: readonly (keyof T)[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = ids.includes(key as keyof T)
      ? number(value as string | null, key)
      : value;
  }
  return out;
}

export function createCatalogRepository(): CatalogPort {
  return {
    institutions: catalogTable<
      Institution,
      typeof schema.institutions.$inferSelect,
      Record<string, never>
    >({
      table: schema.institutions,
      fromRow: (row) => ({
        id: String(row.id),
        bookId: String(row.bookId),
        key: row.key,
        name: row.name,
      }),
      toRow: (fields) => pick(fields),
    }),

    accounts: catalogTable<
      Account,
      typeof schema.accounts.$inferSelect,
      Record<string, never>
    >({
      table: schema.accounts,
      fromRow: (row) => ({
        id: String(row.id),
        bookId: String(row.bookId),
        key: row.key,
        institutionId: text(row.institutionId),
        number: row.number,
        name: row.name,
        type: row.type as Account["type"],
      }),
      toRow: (fields) => pick(fields, ["institutionId"]),
    }),

    accountCycles: catalogTable<
      AccountCycle,
      typeof schema.accountCycles.$inferSelect,
      { accountId?: string }
    >({
      table: schema.accountCycles,
      fromRow: (row) => ({
        id: String(row.id),
        bookId: String(row.bookId),
        accountId: String(row.accountId),
        referenceMonth: row.referenceMonth,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        dueOn: row.dueOn,
      }),
      toRow: (fields) => pick(fields, ["accountId"]),
      where: (filter) =>
        filter.accountId
          ? eq(
              schema.accountCycles.accountId,
              idNumber(filter.accountId, "accountId"),
            )
          : undefined,
    }),

    parties: catalogTable<
      Party,
      typeof schema.parties.$inferSelect,
      Record<string, never>
    >({
      table: schema.parties,
      fromRow: (row) => ({
        id: String(row.id),
        bookId: String(row.bookId),
        key: row.key,
        name: row.name,
        type: row.type,
      }),
      toRow: (fields) => pick(fields, []),
      where: () => undefined,
    }),

    financialCategories: catalogTable<
      FinancialCategory,
      typeof schema.financialCategories.$inferSelect,
      { kind?: FinancialCategory["kind"] }
    >({
      table: schema.financialCategories,
      fromRow: (row) => ({
        id: String(row.id),
        bookId: String(row.bookId),
        parentId: text(row.parentId),
        kind: row.kind,
        name: row.name,
        role: row.role,
      }),
      toRow: (fields) => pick(fields, ["parentId"]),
      where: (filter) =>
        filter.kind
          ? eq(schema.financialCategories.kind, filter.kind)
          : undefined,
    }),
  };
}
