/** The revenue cycle's and transfers' PostgreSQL adapter. */
import { type Db, idNumber } from "@lastro/core/db";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { RevenuePort } from "../application/port";
import type {
  PaymentMethod,
  Receipt,
  Revenue,
  RevenueSettlement,
  Transfer,
} from "../domain/records";
import * as schema from "./schema";

const on = (handle: unknown) => handle as Db;
const book = (bookId: string) => idNumber(bookId, "bookId");
const isId = (value: string) => /^\d+$/.test(value);

function first<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`${what} returned no row`);
  return row;
}

export const revenueFromRow = (
  row: typeof schema.revenues.$inferSelect,
): Revenue => ({
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

export const receiptFromRow = (
  row: typeof schema.receipts.$inferSelect,
): Receipt => ({
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

export const revenueSettlementFromRow = (
  row: typeof schema.revenueSettlements.$inferSelect,
): RevenueSettlement => ({
  id: String(row.id),
  bookId: String(row.bookId),
  revenueId: String(row.revenueId),
  receiptId: String(row.receiptId),
  amount: row.amount,
  currency: row.currency,
  description: row.description,
  voidedAt: row.voidedAt,
  voidedBy: row.voidedBy,
  voidReason: row.voidReason,
});

const transferFromRow = (
  row: typeof schema.transfers.$inferSelect,
): Transfer => ({
  id: String(row.id),
  bookId: String(row.bookId),
  key: row.key,
  sourceAccountId: String(row.sourceAccountId),
  destinationAccountId: String(row.destinationAccountId),
  name: row.name,
  amount: row.amount,
  currency: row.currency,
  referenceMonth: row.referenceMonth,
  occurredOn: row.occurredOn,
  occurredAt: row.occurredAt,
});

export function createRevenueRepository(): RevenuePort {
  const { revenues, receipts, revenueSettlements, transfers } = schema;
  return {
    revenues: {
      async insert(handle, bookId, input) {
        return revenueFromRow(
          first(
            await on(handle)
              .insert(revenues)
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
            "revenue insert",
          ),
        );
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(revenues)
          .where(
            and(eq(revenues.bookId, book(bookId)), eq(revenues.id, Number(id))),
          );
        return row ? revenueFromRow(row) : null;
      },
      async getByKey(handle, bookId, key) {
        const [row] = await on(handle)
          .select()
          .from(revenues)
          .where(and(eq(revenues.bookId, book(bookId)), eq(revenues.key, key)));
        return row ? revenueFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(revenues)
          .where(
            and(
              eq(revenues.bookId, book(bookId)),
              query.after
                ? gt(revenues.id, idNumber(query.after, "cursor"))
                : undefined,
              query.referenceMonth
                ? eq(revenues.referenceMonth, query.referenceMonth)
                : undefined,
            ),
          )
          .orderBy(asc(revenues.id))
          .limit(query.limit);
        return rows.map(revenueFromRow);
      },
    },

    receipts: {
      async insert(handle, bookId, input) {
        return receiptFromRow(
          first(
            await on(handle)
              .insert(receipts)
              .values({
                ...input,
                bookId: book(bookId),
                accountId: idNumber(input.accountId, "accountId"),
              })
              .returning(),
            "receipt insert",
          ),
        );
      },
      async setPaid(handle, bookId, id, paid) {
        await on(handle)
          .update(receipts)
          .set(paid)
          .where(
            and(
              eq(receipts.bookId, book(bookId)),
              eq(receipts.id, idNumber(id, "id")),
            ),
          );
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(receipts)
          .where(
            and(eq(receipts.bookId, book(bookId)), eq(receipts.id, Number(id))),
          );
        return row ? receiptFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(receipts)
          .where(
            and(
              eq(receipts.bookId, book(bookId)),
              query.after
                ? gt(receipts.id, idNumber(query.after, "cursor"))
                : undefined,
              query.accountId
                ? eq(receipts.accountId, idNumber(query.accountId, "accountId"))
                : undefined,
            ),
          )
          .orderBy(asc(receipts.id))
          .limit(query.limit);
        return rows.map(receiptFromRow);
      },
    },

    revenueSettlements: {
      async insert(handle, bookId, input) {
        return revenueSettlementFromRow(
          first(
            await on(handle)
              .insert(revenueSettlements)
              .values({
                ...input,
                bookId: book(bookId),
                revenueId: idNumber(input.revenueId, "revenueId"),
                receiptId: idNumber(input.receiptId, "receiptId"),
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
          .from(revenueSettlements)
          .where(
            and(
              eq(revenueSettlements.bookId, book(bookId)),
              eq(revenueSettlements.id, Number(id)),
            ),
          );
        return row ? revenueSettlementFromRow(row) : null;
      },
      async list(handle, bookId, filter) {
        const rows = await on(handle)
          .select()
          .from(revenueSettlements)
          .where(
            and(
              eq(revenueSettlements.bookId, book(bookId)),
              filter.revenueId
                ? eq(
                    revenueSettlements.revenueId,
                    idNumber(filter.revenueId, "revenueId"),
                  )
                : undefined,
              filter.receiptId
                ? eq(
                    revenueSettlements.receiptId,
                    idNumber(filter.receiptId, "receiptId"),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(revenueSettlements.id));
        return rows.map(revenueSettlementFromRow);
      },
      async void(handle, bookId, id, by) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .update(revenueSettlements)
          .set({ voidedAt: new Date(), ...by })
          .where(
            and(
              eq(revenueSettlements.bookId, book(bookId)),
              eq(revenueSettlements.id, Number(id)),
              isNull(revenueSettlements.voidedAt),
            ),
          )
          .returning();
        return row ? revenueSettlementFromRow(row) : null;
      },
    },

    async lockRevenueSet(handle, bookId, revenueId, receiptId) {
      for (const key of [
        `revenue:${bookId}:${revenueId}`,
        `receipt:${bookId}:${receiptId}`,
      ])
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${key}))`,
        );
    },

    transfers: {
      async insert(handle, bookId, input) {
        return transferFromRow(
          first(
            await on(handle)
              .insert(transfers)
              .values({
                ...input,
                bookId: book(bookId),
                sourceAccountId: idNumber(
                  input.sourceAccountId,
                  "sourceAccountId",
                ),
                destinationAccountId: idNumber(
                  input.destinationAccountId,
                  "destinationAccountId",
                ),
              })
              .returning(),
            "transfer insert",
          ),
        );
      },
      async list(handle, bookId, query) {
        const account = query.accountId
          ? idNumber(query.accountId, "accountId")
          : undefined;
        const rows = await on(handle)
          .select()
          .from(transfers)
          .where(
            and(
              eq(transfers.bookId, book(bookId)),
              query.after
                ? gt(transfers.id, idNumber(query.after, "cursor"))
                : undefined,
              account === undefined
                ? undefined
                : or(
                    eq(transfers.sourceAccountId, account),
                    eq(transfers.destinationAccountId, account),
                  ),
            ),
          )
          .orderBy(asc(transfers.id))
          .limit(query.limit);
        return rows.map(transferFromRow);
      },
      async remove(handle, bookId, id) {
        await on(handle)
          .delete(transfers)
          .where(
            and(
              eq(transfers.bookId, book(bookId)),
              eq(transfers.id, idNumber(id, "transferId")),
            ),
          );
      },
    },
  };
}
