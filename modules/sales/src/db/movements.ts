/** Sales evidence's PostgreSQL adapter (ADR 21). */
import { type Db, idNumber } from "@lastro/core/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import type { SaleEvidencePort } from "../application/port";
import type {
  SaleConsumer,
  SaleFile,
  SaleMovement,
  SaleMovementDescriptor,
  SaleMovementLink,
  SaleMovementStatus,
} from "../domain/movements";
import { quantityText } from "./days";
import * as schema from "./schema";

const on = (handle: unknown) => handle as Db;
const book = (bookId: string) => idNumber(bookId, "bookId");
const isId = (value: string) => /^\d+$/.test(value);

function first<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`${what} returned no row`);
  return row;
}

const {
  saleConsumers: consumers,
  saleFiles: files,
  saleMovementDescriptors: descriptors,
  saleMovements: movements,
  saleMovementLinks: links,
} = schema;

const consumerFromRow = (row: typeof consumers.$inferSelect): SaleConsumer => ({
  bookId: String(row.bookId),
  movementType: row.movementType,
  importerId: row.importerId,
  setBy: row.setBy,
  setAt: row.setAt,
});

const fileFromRow = (row: typeof files.$inferSelect): SaleFile => ({
  id: String(row.id),
  bookId: String(row.bookId),
  movementType: row.movementType,
  importerId: row.importerId,
  importerVersion: row.importerVersion,
  importerFingerprint: row.importerFingerprint,
  contentSha256: row.contentSha256,
  sourceKey: row.sourceKey,
  lineCount: row.lineCount,
  newCount: row.newCount,
  importedBy: row.importedBy,
  importedAt: row.importedAt,
});

const descriptorFromRow = (
  row: typeof descriptors.$inferSelect,
): SaleMovementDescriptor => ({
  bookId: String(row.bookId),
  descriptorKey: row.descriptorKey,
  name: row.name,
  productId: row.productId === null ? null : String(row.productId),
});

const movementFromRow = (row: typeof movements.$inferSelect): SaleMovement => ({
  id: String(row.id),
  bookId: String(row.bookId),
  fileId: String(row.fileId),
  externalId: row.externalId,
  businessDate: row.businessDate,
  code: row.code,
  name: row.name,
  providerCategory: row.providerCategory,
  descriptorKey: row.descriptorKey,
  quantity: quantityText(row.quantity),
  revenue: row.revenue,
  cost: row.cost,
  currency: row.currency,
  status: row.status as SaleMovementStatus,
  ignoreReason: row.ignoreReason,
});

const linkFromRow = (row: typeof links.$inferSelect): SaleMovementLink => ({
  bookId: String(row.bookId),
  movementId: String(row.movementId),
  externalKey: row.externalKey,
  saleKey: row.saleKey,
  saleId: String(row.saleId),
});

const descriptorWhere = (bookId: string, key: string) =>
  and(eq(descriptors.bookId, book(bookId)), eq(descriptors.descriptorKey, key));

export function createSaleEvidenceRepository(): SaleEvidencePort {
  return {
    saleConsumers: {
      async get(handle, bookId, movementType) {
        const [row] = await on(handle)
          .select()
          .from(consumers)
          .where(
            and(
              eq(consumers.bookId, book(bookId)),
              eq(consumers.movementType, movementType),
            ),
          );
        return row ? consumerFromRow(row) : null;
      },
      async set(handle, bookId, input) {
        return consumerFromRow(
          first(
            await on(handle)
              .insert(consumers)
              .values({ ...input, bookId: book(bookId) })
              .onConflictDoUpdate({
                target: [consumers.bookId, consumers.movementType],
                set: {
                  importerId: input.importerId,
                  setBy: input.setBy,
                  setAt: sql`now()`,
                },
              })
              .returning(),
            "sale consumer set",
          ),
        );
      },
      async list(handle, bookId) {
        const rows = await on(handle)
          .select()
          .from(consumers)
          .where(eq(consumers.bookId, book(bookId)))
          .orderBy(asc(consumers.movementType));
        return rows.map(consumerFromRow);
      },
    },

    saleFiles: {
      async findByContent(handle, bookId, query) {
        const [row] = await on(handle)
          .select()
          .from(files)
          .where(
            and(
              eq(files.bookId, book(bookId)),
              eq(files.importerFingerprint, query.importerFingerprint),
              eq(files.contentSha256, query.contentSha256),
            ),
          );
        return row ? fileFromRow(row) : null;
      },
      async insert(handle, bookId, input) {
        return fileFromRow(
          first(
            await on(handle)
              .insert(files)
              .values({ ...input, bookId: book(bookId) })
              .returning(),
            "sale file insert",
          ),
        );
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(files)
          .where(
            and(
              eq(files.bookId, book(bookId)),
              query.after
                ? lt(files.id, idNumber(query.after, "cursor"))
                : undefined,
            ),
          )
          .orderBy(desc(files.id))
          .limit(query.limit);
        return rows.map(fileFromRow);
      },
    },

    saleMovementDescriptors: {
      async ensure(handle, bookId, input) {
        await on(handle)
          .insert(descriptors)
          .values({ ...input, bookId: book(bookId) })
          .onConflictDoNothing();
        return descriptorFromRow(
          first(
            await on(handle)
              .select()
              .from(descriptors)
              .where(descriptorWhere(bookId, input.descriptorKey)),
            "sale descriptor ensure",
          ),
        );
      },
      async get(handle, bookId, key) {
        const [row] = await on(handle)
          .select()
          .from(descriptors)
          .where(descriptorWhere(bookId, key));
        return row ? descriptorFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(descriptors)
          .where(
            and(
              eq(descriptors.bookId, book(bookId)),
              query.classified === undefined
                ? undefined
                : query.classified
                  ? isNotNull(descriptors.productId)
                  : isNull(descriptors.productId),
            ),
          )
          .orderBy(asc(descriptors.descriptorKey));
        return rows.map(descriptorFromRow);
      },
      async classify(handle, bookId, key, productId) {
        return descriptorFromRow(
          first(
            await on(handle)
              .update(descriptors)
              .set({ productId: idNumber(productId, "productId") })
              .where(descriptorWhere(bookId, key))
              .returning(),
            "sale descriptor classify",
          ),
        );
      },
    },

    saleMovements: {
      async findByExternalIds(handle, bookId, externalIds) {
        if (externalIds.length === 0) return [];
        const rows = await on(handle)
          .select()
          .from(movements)
          .where(
            and(
              eq(movements.bookId, book(bookId)),
              inArray(movements.externalId, [...externalIds]),
            ),
          );
        return rows.map(movementFromRow);
      },
      async insert(handle, bookId, input) {
        return movementFromRow(
          first(
            await on(handle)
              .insert(movements)
              .values({
                ...input,
                bookId: book(bookId),
                fileId: idNumber(input.fileId, "fileId"),
              })
              .returning(),
            "sale movement insert",
          ),
        );
      },
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(movements)
          .where(
            and(
              eq(movements.bookId, book(bookId)),
              eq(movements.id, Number(id)),
            ),
          );
        return row ? movementFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(movements)
          .where(
            and(
              eq(movements.bookId, book(bookId)),
              query.status ? eq(movements.status, query.status) : undefined,
              query.descriptorKey
                ? eq(movements.descriptorKey, query.descriptorKey)
                : undefined,
              query.businessDate
                ? eq(movements.businessDate, query.businessDate)
                : undefined,
              query.after
                ? lt(movements.id, idNumber(query.after, "cursor"))
                : undefined,
            ),
          )
          .orderBy(desc(movements.id))
          .limit(query.limit);
        return rows.map(movementFromRow);
      },
      async update(handle, bookId, id, patch) {
        return movementFromRow(
          first(
            await on(handle)
              .update(movements)
              .set(patch)
              .where(
                and(
                  eq(movements.bookId, book(bookId)),
                  eq(movements.id, idNumber(id, "id")),
                ),
              )
              .returning(),
            "sale movement update",
          ),
        );
      },
      async lock(handle, bookId, id) {
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${`sale-movement:${bookId}:${id}`}))`,
        );
      },
    },
    saleLinks: {
      async insert(handle, bookId, input) {
        return linkFromRow(
          first(
            await on(handle)
              .insert(links)
              .values({
                ...input,
                bookId: book(bookId),
                movementId: idNumber(input.movementId, "movementId"),
                saleId: idNumber(input.saleId, "saleId"),
              })
              .returning(),
            "sale link insert",
          ),
        );
      },
      async list(handle, bookId, query) {
        if (query.movementId && !isId(query.movementId)) return [];
        if (query.saleId && !isId(query.saleId)) return [];
        const rows = await on(handle)
          .select()
          .from(links)
          .where(
            and(
              eq(links.bookId, book(bookId)),
              query.movementId
                ? eq(links.movementId, Number(query.movementId))
                : undefined,
              query.externalKey
                ? eq(links.externalKey, query.externalKey)
                : undefined,
              query.saleKey ? eq(links.saleKey, query.saleKey) : undefined,
              query.saleId ? eq(links.saleId, Number(query.saleId)) : undefined,
            ),
          )
          .orderBy(asc(links.movementId));
        return rows.map(linkFromRow);
      },
      async removeOfMovement(handle, bookId, movementId) {
        await on(handle)
          .delete(links)
          .where(
            and(
              eq(links.bookId, book(bookId)),
              eq(links.movementId, idNumber(movementId, "movementId")),
            ),
          );
      },
    },
  };
}
