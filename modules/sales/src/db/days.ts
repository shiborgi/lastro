/** Sale lines' PostgreSQL adapter; a day is derived from its lines. */
import { type Db, idNumber } from "@lastro/core/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { SalesDayPort } from "../application/port";
import type { SaleLine } from "../domain/day";
import * as schema from "./schema";

const on = (handle: unknown) => handle as Db;
const book = (bookId: string) => idNumber(bookId, "bookId");

/* numeric(18,6) reads back padded; quantities are compared and shown normalized. */
export const quantityText = (value: string) =>
  value.includes(".") ? value.replace(/\.?0+$/, "") || "0" : value;

const lineFromRow = (row: typeof schema.sales.$inferSelect): SaleLine => ({
  id: String(row.id),
  bookId: String(row.bookId),
  businessDate: row.businessDate,
  currency: row.currency,
  productId: String(row.productId),
  quantity: quantityText(row.quantity),
  revenue: row.revenue,
  unitCost: row.unitCost,
  cost: row.cost,
  costSource: row.costSource,
});

export function createSalesDayRepository(): SalesDayPort {
  const { sales } = schema;
  const inRange = (bookId: string, range: { from?: Date; to?: Date }) =>
    and(
      eq(sales.bookId, book(bookId)),
      range.from ? gte(sales.businessDate, range.from) : undefined,
      range.to ? lte(sales.businessDate, range.to) : undefined,
    );
  return {
    lines: {
      async insert(handle, bookId, line) {
        const [row] = await on(handle)
          .insert(sales)
          .values({
            ...line,
            bookId: book(bookId),
            productId: idNumber(line.productId, "productId"),
          })
          .returning();
        return lineFromRow(row as typeof sales.$inferSelect);
      },
      async remove(handle, bookId, id) {
        await on(handle)
          .delete(sales)
          .where(
            and(
              eq(sales.bookId, book(bookId)),
              eq(sales.id, idNumber(id, "id")),
            ),
          );
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(sales)
          .where(
            and(
              inRange(bookId, query),
              query.businessDate
                ? eq(sales.businessDate, query.businessDate)
                : undefined,
            ),
          )
          .orderBy(asc(sales.id));
        return rows.map(lineFromRow);
      },
      async days(handle, bookId, range) {
        const rows = await on(handle)
          .selectDistinct({
            businessDate: sales.businessDate,
            currency: sales.currency,
          })
          .from(sales)
          .where(inRange(bookId, range))
          .orderBy(asc(sales.businessDate));
        return rows.map((row) => ({ bookId, ...row }));
      },
    },
  };
}
