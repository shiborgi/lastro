/** Revenue movement evidence's PostgreSQL adapter (ADR 19). */
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
  or,
  sql,
} from "drizzle-orm";
import type { RevenueMovementPort } from "../application/port";
import type { MovementStatus } from "../domain/account-movements";
import type {
  RevenueComponent,
  RevenueMovement,
  RevenueMovementDescriptor,
  RevenueMovementLink,
  RevenueMovementReceipt,
} from "../domain/revenue-movements";
import {
  revenueMovementReceipts as collected,
  revenueMovementDescriptors as descriptors,
  revenueMovementLinks as links,
  revenueMovements as movements,
} from "./schema";

const on = (handle: unknown) => handle as Db;
const book = (bookId: string) => idNumber(bookId, "bookId");
const isId = (value: string) => /^\d+$/.test(value);
const text = (value: number | null) => (value === null ? null : String(value));
const number = (value: string | null | undefined, field: string) =>
  value == null ? null : idNumber(value, field);

function first<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`${what} returned no row`);
  return row;
}

const descriptorFromRow = (
  row: typeof descriptors.$inferSelect,
): RevenueMovementDescriptor => ({
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  descriptorKey: row.descriptorKey,
  component: row.component as RevenueComponent,
  name: row.name,
  partyId: text(row.partyId),
  financialCategoryId: text(row.financialCategoryId),
  settlementGroup: row.settlementGroup,
  settlesMethodKey: row.settlesMethodKey,
  receivedAccountId: text(row.receivedAccountId),
});

const collectedFromRow = (
  row: typeof collected.$inferSelect,
): RevenueMovementReceipt => ({
  bookId: String(row.bookId),
  movementId: String(row.movementId),
  receiptId: String(row.receiptId),
  own: row.own,
});

const movementFromRow = (
  row: typeof movements.$inferSelect,
): RevenueMovement => ({
  id: String(row.id),
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  fileId: String(row.fileId),
  externalId: row.externalId,
  occurredOn: row.occurredOn,
  name: row.name,
  methodKey: row.methodKey,
  quantity: row.quantity,
  gross: row.gross,
  discount: row.discount,
  fee: row.fee,
  acquirerFee: row.acquirerFee,
  grossRecognized: row.grossRecognized,
  amount: row.amount,
  currency: row.currency,
  status: row.status as MovementStatus,
  ignoreReason: row.ignoreReason,
});

const linkFromRow = (row: typeof links.$inferSelect): RevenueMovementLink => ({
  bookId: String(row.bookId),
  movementId: String(row.movementId),
  component: row.component as RevenueComponent,
  externalKey: row.externalKey,
  statementId: row.statementId,
  revenueKey: row.revenueKey,
  revenueId: String(row.revenueId),
});

const descriptorWhere = (bookId: string, accountId: string, key: string) =>
  and(
    eq(descriptors.bookId, book(bookId)),
    eq(descriptors.accountId, idNumber(accountId, "accountId")),
    eq(descriptors.descriptorKey, key),
  );

export function createRevenueMovementRepository(): RevenueMovementPort {
  return {
    revenueMovementDescriptors: {
      async ensure(handle, bookId, input) {
        await on(handle)
          .insert(descriptors)
          .values({
            bookId: book(bookId),
            accountId: idNumber(input.accountId, "accountId"),
            descriptorKey: input.descriptorKey,
            component: input.component,
            name: input.name,
          })
          .onConflictDoNothing();
        return descriptorFromRow(
          first(
            await on(handle)
              .select()
              .from(descriptors)
              .where(
                descriptorWhere(bookId, input.accountId, input.descriptorKey),
              ),
            "revenue movement descriptor ensure",
          ),
        );
      },
      async get(handle, bookId, accountId, descriptorKey) {
        if (!isId(accountId)) return null;
        const [row] = await on(handle)
          .select()
          .from(descriptors)
          .where(descriptorWhere(bookId, accountId, descriptorKey));
        return row ? descriptorFromRow(row) : null;
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(descriptors)
          .where(
            and(
              eq(descriptors.bookId, book(bookId)),
              query.accountId
                ? eq(
                    descriptors.accountId,
                    idNumber(query.accountId, "accountId"),
                  )
                : undefined,
              query.classified === undefined
                ? undefined
                : query.classified
                  ? or(
                      isNotNull(descriptors.partyId),
                      isNotNull(descriptors.financialCategoryId),
                    )
                  : and(
                      isNull(descriptors.partyId),
                      isNull(descriptors.financialCategoryId),
                    ),
              query.settlementGroup
                ? eq(descriptors.settlementGroup, query.settlementGroup)
                : undefined,
            ),
          )
          .orderBy(asc(descriptors.accountId), asc(descriptors.descriptorKey));
        return rows.map(descriptorFromRow);
      },
      async classify(handle, bookId, input) {
        return descriptorFromRow(
          first(
            await on(handle)
              .update(descriptors)
              .set({
                partyId: number(input.partyId, "partyId"),
                financialCategoryId: number(
                  input.financialCategoryId,
                  "financialCategoryId",
                ),
                settlementGroup: input.settlementGroup,
                settlesMethodKey: input.settlesMethodKey,
                receivedAccountId: number(
                  input.receivedAccountId,
                  "receivedAccountId",
                ),
              })
              .where(
                descriptorWhere(bookId, input.accountId, input.descriptorKey),
              )
              .returning(),
            "revenue movement descriptor classify",
          ),
        );
      },
    },

    revenueMovements: {
      async findByExternalIds(handle, bookId, accountId, externalIds) {
        if (externalIds.length === 0) return [];
        const rows = await on(handle)
          .select()
          .from(movements)
          .where(
            and(
              eq(movements.bookId, book(bookId)),
              eq(movements.accountId, idNumber(accountId, "accountId")),
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
                accountId: idNumber(input.accountId, "accountId"),
                fileId: idNumber(input.fileId, "fileId"),
              })
              .returning(),
            "revenue movement insert",
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
              query.accountId
                ? eq(
                    movements.accountId,
                    idNumber(query.accountId, "accountId"),
                  )
                : undefined,
              query.status ? eq(movements.status, query.status) : undefined,
              query.methodKey
                ? eq(movements.methodKey, query.methodKey)
                : undefined,
              query.occurredOn
                ? eq(movements.occurredOn, query.occurredOn)
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
        const values: Record<string, unknown> = {};
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.ignoreReason !== undefined)
          values.ignoreReason = patch.ignoreReason;
        return movementFromRow(
          first(
            await on(handle)
              .update(movements)
              .set(values)
              .where(
                and(
                  eq(movements.bookId, book(bookId)),
                  eq(movements.id, idNumber(id, "id")),
                ),
              )
              .returning(),
            "revenue movement update",
          ),
        );
      },
      async lock(handle, bookId, id) {
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${`revenue-movement:${bookId}:${id}`}))`,
        );
      },
    },

    revenueMovementLinks: {
      async insert(handle, bookId, input) {
        return linkFromRow(
          first(
            await on(handle)
              .insert(links)
              .values({
                bookId: book(bookId),
                movementId: idNumber(input.movementId, "movementId"),
                component: input.component,
                externalKey: input.externalKey,
                statementId: input.statementId,
                revenueKey: input.revenueKey,
                revenueId: idNumber(input.revenueId, "revenueId"),
              })
              .returning(),
            "revenue movement link insert",
          ),
        );
      },
      async list(handle, bookId, query) {
        if (query.movementId && !isId(query.movementId)) return [];
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
              query.revenueKey
                ? eq(links.revenueKey, query.revenueKey)
                : undefined,
              query.statementId
                ? eq(links.statementId, query.statementId)
                : undefined,
            ),
          )
          .orderBy(asc(links.movementId), asc(links.component));
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

    revenueMovementReceipts: {
      async insert(handle, bookId, input) {
        return collectedFromRow(
          first(
            await on(handle)
              .insert(collected)
              .values({
                bookId: book(bookId),
                movementId: idNumber(input.movementId, "movementId"),
                receiptId: idNumber(input.receiptId, "receiptId"),
                own: input.own,
              })
              .returning(),
            "revenue movement receipt insert",
          ),
        );
      },
      async list(handle, bookId, query) {
        if (query.movementId && !isId(query.movementId)) return [];
        if (query.receiptId && !isId(query.receiptId)) return [];
        const rows = await on(handle)
          .select()
          .from(collected)
          .where(
            and(
              eq(collected.bookId, book(bookId)),
              query.movementId
                ? eq(collected.movementId, Number(query.movementId))
                : undefined,
              query.receiptId
                ? eq(collected.receiptId, Number(query.receiptId))
                : undefined,
            ),
          )
          .orderBy(asc(collected.movementId));
        return rows.map(collectedFromRow);
      },
      async removeOfReceipt(handle, bookId, receiptId) {
        await on(handle)
          .delete(collected)
          .where(
            and(
              eq(collected.bookId, book(bookId)),
              eq(collected.receiptId, idNumber(receiptId, "receiptId")),
            ),
          );
      },
      async removeOfMovement(handle, bookId, movementId) {
        await on(handle)
          .delete(collected)
          .where(
            and(
              eq(collected.bookId, book(bookId)),
              eq(collected.movementId, idNumber(movementId, "movementId")),
            ),
          );
      },
    },
  };
}
