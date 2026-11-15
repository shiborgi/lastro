/** The product catalog's PostgreSQL adapter. */
import { type Db, idNumber } from "@lastro/core/db";
import { type SQL, and, asc, eq } from "drizzle-orm";
import type { SalesCatalogPort } from "../application/port";
import type { Product, ProductCategory } from "../domain/catalog";
import * as schema from "./schema";

const on = (handle: unknown) => handle as Db;
const book = (bookId: string) => idNumber(bookId, "bookId");
const isId = (value: string) => /^\d+$/.test(value);
const text = (value: number | null) => (value === null ? null : String(value));
const number = (value: string | null | undefined, field: string) =>
  value == null ? null : idNumber(value, field);

const categoryFromRow = (
  row: typeof schema.productCategories.$inferSelect,
): ProductCategory => ({
  id: String(row.id),
  bookId: String(row.bookId),
  key: row.key,
  name: row.name,
  parentId: text(row.parentId),
});

const productFromRow = (row: typeof schema.products.$inferSelect): Product => ({
  id: String(row.id),
  bookId: String(row.bookId),
  key: row.key,
  name: row.name,
  productCategoryId: String(row.productCategoryId),
  costOverride: row.costOverride,
  active: row.active,
});

function defined<T extends object>(fields: T, ids: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = ids.includes(key) ? number(value as string | null, key) : value;
  }
  return out;
}

export function createSalesCatalogRepository(): SalesCatalogPort {
  const { productCategories, products } = schema;
  const where = (
    table: typeof productCategories | typeof products,
    bookId: string,
    id: string,
  ) => and(eq(table.bookId, book(bookId)), eq(table.id, Number(id)));
  return {
    productCategories: {
      async list(handle, bookId) {
        const rows = await on(handle)
          .select()
          .from(productCategories)
          .where(eq(productCategories.bookId, book(bookId)))
          .orderBy(asc(productCategories.id));
        return rows.map(categoryFromRow);
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(productCategories)
          .where(where(productCategories, bookId, id));
        return row ? categoryFromRow(row) : null;
      },
      async insert(handle, bookId, input) {
        const [row] = await on(handle)
          .insert(productCategories)
          .values({
            ...input,
            bookId: book(bookId),
            parentId: number(input.parentId, "parentId"),
          })
          .returning();
        return categoryFromRow(row as typeof productCategories.$inferSelect);
      },
      async update(handle, bookId, id, patch) {
        if (!isId(id)) return null;
        const values = defined(patch, ["parentId"]);
        if (Object.keys(values).length === 0)
          return this.get(handle, bookId, id);
        const [row] = await on(handle)
          .update(productCategories)
          .set(values)
          .where(where(productCategories, bookId, id))
          .returning();
        return row ? categoryFromRow(row) : null;
      },
      async remove(handle, bookId, id) {
        if (!isId(id)) return false;
        return (
          (
            await on(handle)
              .delete(productCategories)
              .where(where(productCategories, bookId, id))
              .returning()
          ).length > 0
        );
      },
    },
    products: {
      async list(handle, bookId, filter) {
        const conditions: (SQL | undefined)[] = [
          eq(products.bookId, book(bookId)),
          filter?.productCategoryId
            ? eq(
                products.productCategoryId,
                idNumber(filter.productCategoryId, "productCategoryId"),
              )
            : undefined,
          filter?.active === undefined
            ? undefined
            : eq(products.active, filter.active),
        ];
        const rows = await on(handle)
          .select()
          .from(products)
          .where(and(...conditions))
          .orderBy(asc(products.id));
        return rows.map(productFromRow);
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(products)
          .where(where(products, bookId, id));
        return row ? productFromRow(row) : null;
      },
      async insert(handle, bookId, input) {
        const [row] = await on(handle)
          .insert(products)
          .values({
            ...input,
            bookId: book(bookId),
            productCategoryId: idNumber(
              input.productCategoryId,
              "productCategoryId",
            ),
          })
          .returning();
        return productFromRow(row as typeof products.$inferSelect);
      },
      async update(handle, bookId, id, patch) {
        if (!isId(id)) return null;
        const values = defined(patch, ["productCategoryId"]);
        if (Object.keys(values).length === 0)
          return this.get(handle, bookId, id);
        const [row] = await on(handle)
          .update(products)
          .set(values)
          .where(where(products, bookId, id))
          .returning();
        return row ? productFromRow(row) : null;
      },
      async remove(handle, bookId, id) {
        if (!isId(id)) return false;
        return (
          (
            await on(handle)
              .delete(products)
              .where(where(products, bookId, id))
              .returning()
          ).length > 0
        );
      },
    },
  };
}
