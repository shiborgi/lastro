/** The expense cycle's PostgreSQL adapter. */
import { type Db, idNumber } from "@lastro/core/db";
import { and, asc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import type { ExpensePort } from "../application/port";
import type {
  Expense,
  ExpenseSettlement,
  Payment,
  PaymentMethod,
} from "../domain/records";
import * as schema from "./schema";

const on = (handle: unknown) => handle as Db;
const book = (bookId: string) => idNumber(bookId, "bookId");
/* An id that is not a number names no record: not found, not an error. */
const isId = (value: string) => /^\d+$/.test(value);

const expenseFromRow = (row: typeof schema.expenses.$inferSelect): Expense => ({
  id: String(row.id),
  bookId: String(row.bookId),
  key: row.key,
  partyId: String(row.partyId),
  financialCategoryId: String(row.financialCategoryId),
  name: row.name,
  amount: row.amount,
  currency: row.currency,
  referenceMonth: row.referenceMonth,
  occurredOn: row.occurredOn,
  occurredAt: row.occurredAt,
});

const paymentFromRow = (row: typeof schema.payments.$inferSelect): Payment => ({
  id: String(row.id),
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  key: row.key,
  method: row.method as PaymentMethod | null,
  amount: row.amount,
  currency: row.currency,
  referenceMonth: row.referenceMonth,
  dueOn: row.dueOn,
  dueAt: row.dueAt,
  paidOn: row.paidOn,
  paidAt: row.paidAt,
});

const settlementFromRow = (
  row: typeof schema.expenseSettlements.$inferSelect,
): ExpenseSettlement => ({
  id: String(row.id),
  bookId: String(row.bookId),
  expenseId: String(row.expenseId),
  paymentId: String(row.paymentId),
  amount: row.amount,
  currency: row.currency,
  installmentNumber: row.installmentNumber,
  installmentCount: row.installmentCount,
  description: row.description,
  voidedAt: row.voidedAt,
  voidedBy: row.voidedBy,
  voidReason: row.voidReason,
});

function first<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`${what} returned no row`);
  return row;
}

export function createExpenseRepository(): ExpensePort {
  const { expenses, payments, expenseSettlements } = schema;
  return {
    expenses: {
      async insert(handle, bookId, input) {
        return expenseFromRow(
          first(
            await on(handle)
              .insert(expenses)
              .values({
                ...input,
                bookId: book(bookId),
                partyId: idNumber(input.partyId, "partyId"),
                financialCategoryId: idNumber(
                  input.financialCategoryId,
                  "financialCategoryId",
                ),
              })
              .returning(),
            "expense insert",
          ),
        );
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(expenses)
          .where(
            and(eq(expenses.bookId, book(bookId)), eq(expenses.id, Number(id))),
          );
        return row ? expenseFromRow(row) : null;
      },
      async getByKey(handle, bookId, key) {
        const [row] = await on(handle)
          .select()
          .from(expenses)
          .where(and(eq(expenses.bookId, book(bookId)), eq(expenses.key, key)));
        return row ? expenseFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.bookId, book(bookId)),
              query.after
                ? gt(expenses.id, idNumber(query.after, "cursor"))
                : undefined,
              query.referenceMonth
                ? eq(expenses.referenceMonth, query.referenceMonth)
                : undefined,
            ),
          )
          .orderBy(asc(expenses.id))
          .limit(query.limit);
        return rows.map(expenseFromRow);
      },
      async listByReferenceMonth(handle, bookId, from, to) {
        const rows = await on(handle)
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.bookId, book(bookId)),
              gte(expenses.referenceMonth, from),
              lt(expenses.referenceMonth, to),
            ),
          )
          .orderBy(asc(expenses.id));
        return rows.map(expenseFromRow);
      },
      async listPositive(handle, bookId) {
        const rows = await on(handle)
          .select()
          .from(expenses)
          .where(
            and(eq(expenses.bookId, book(bookId)), gt(expenses.amount, 0n)),
          )
          .orderBy(asc(expenses.id));
        return rows.map(expenseFromRow);
      },
    },

    payments: {
      async insert(handle, bookId, input) {
        return paymentFromRow(
          first(
            await on(handle)
              .insert(payments)
              .values({
                ...input,
                bookId: book(bookId),
                accountId: idNumber(input.accountId, "accountId"),
              })
              .returning(),
            "payment insert",
          ),
        );
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(payments)
          .where(
            and(eq(payments.bookId, book(bookId)), eq(payments.id, Number(id))),
          );
        return row ? paymentFromRow(row) : null;
      },
      async getByKey(handle, bookId, key) {
        const [row] = await on(handle)
          .select()
          .from(payments)
          .where(and(eq(payments.bookId, book(bookId)), eq(payments.key, key)));
        return row ? paymentFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.bookId, book(bookId)),
              query.after
                ? gt(payments.id, idNumber(query.after, "cursor"))
                : undefined,
              query.accountId
                ? eq(payments.accountId, idNumber(query.accountId, "accountId"))
                : undefined,
            ),
          )
          .orderBy(asc(payments.id))
          .limit(query.limit);
        return rows.map(paymentFromRow);
      },
    },

    expenseSettlements: {
      async insert(handle, bookId, input) {
        return settlementFromRow(
          first(
            await on(handle)
              .insert(expenseSettlements)
              .values({
                ...input,
                bookId: book(bookId),
                expenseId: idNumber(input.expenseId, "expenseId"),
                paymentId: idNumber(input.paymentId, "paymentId"),
              })
              .returning(),
            "settlement insert",
          ),
        );
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(expenseSettlements)
          .where(
            and(
              eq(expenseSettlements.bookId, book(bookId)),
              eq(expenseSettlements.id, Number(id)),
            ),
          );
        return row ? settlementFromRow(row) : null;
      },
      async list(handle, bookId, filter) {
        const rows = await on(handle)
          .select()
          .from(expenseSettlements)
          .where(
            and(
              eq(expenseSettlements.bookId, book(bookId)),
              filter.expenseId
                ? eq(
                    expenseSettlements.expenseId,
                    idNumber(filter.expenseId, "expenseId"),
                  )
                : undefined,
              filter.paymentId
                ? eq(
                    expenseSettlements.paymentId,
                    idNumber(filter.paymentId, "paymentId"),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(expenseSettlements.id));
        return rows.map(settlementFromRow);
      },
      async void(handle, bookId, id, by) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .update(expenseSettlements)
          .set({ voidedAt: new Date(), ...by })
          .where(
            and(
              eq(expenseSettlements.bookId, book(bookId)),
              eq(expenseSettlements.id, Number(id)),
              isNull(expenseSettlements.voidedAt),
            ),
          )
          .returning();
        return row ? settlementFromRow(row) : null;
      },
    },

    async lockSettlementSet(handle, bookId, expenseId, paymentId) {
      for (const key of [
        `expense:${bookId}:${expenseId}`,
        `payment:${bookId}:${paymentId}`,
      ])
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${key}))`,
        );
    },
  };
}
