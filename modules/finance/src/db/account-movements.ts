/** Account movement evidence's PostgreSQL adapter (ADR 17). */
import { type Db, idNumber } from "@lastro/core/db";
import {
  type SQL,
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
import type { AccountMovementPort } from "../application/port";
import type {
  AccountMovement,
  AccountMovementDescriptor,
  AccountMovementLink,
  AccountMovementMapping,
  DescriptorRef,
  MovementConsumer,
  MovementDirection,
  MovementFile,
  MovementStatus,
} from "../domain/account-movements";
import type { PaymentMethod } from "../domain/records";
import * as schema from "./schema";

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

const { movementFiles: files, movementConsumers: consumers } = schema;
const movementTables = {
  PAYMENT: schema.paymentMovements,
  RECEIPT: schema.receiptMovements,
} as const;
const descriptorTables = {
  PAYMENT: schema.paymentMovementDescriptors,
  RECEIPT: schema.receiptMovementDescriptors,
} as const;
const linkTables = {
  PAYMENT: schema.paymentMovementLinks,
  RECEIPT: schema.receiptMovementLinks,
} as const;
const directions = ["PAYMENT", "RECEIPT"] as const;

const mappingValues = (mapping: Partial<AccountMovementMapping>) => {
  const values: Record<string, unknown> = {};
  if (mapping.partyId !== undefined)
    values.partyId = number(mapping.partyId, "partyId");
  if (mapping.financialCategoryId !== undefined)
    values.financialCategoryId = number(
      mapping.financialCategoryId,
      "financialCategoryId",
    );
  if (mapping.counterAccountId !== undefined)
    values.counterAccountId = number(
      mapping.counterAccountId,
      "counterAccountId",
    );
  if (mapping.paymentMethod !== undefined)
    values.paymentMethod = mapping.paymentMethod;
  if (mapping.settlementGroup !== undefined)
    values.settlementGroup = mapping.settlementGroup;
  return values;
};

const mappingFromRow = (row: {
  partyId: number | null;
  financialCategoryId: number | null;
  counterAccountId: number | null;
  paymentMethod: string | null;
  settlementGroup: string | null;
}): AccountMovementMapping => ({
  partyId: text(row.partyId),
  financialCategoryId: text(row.financialCategoryId),
  counterAccountId: text(row.counterAccountId),
  paymentMethod: row.paymentMethod as PaymentMethod | null,
  settlementGroup: row.settlementGroup,
});

const consumerFromRow = (
  row: typeof consumers.$inferSelect,
): MovementConsumer => ({
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  movementType: row.movementType,
  importerId: row.importerId,
  setBy: row.setBy,
  setAt: row.setAt,
});

const fileFromRow = (row: typeof files.$inferSelect): MovementFile => ({
  id: String(row.id),
  bookId: String(row.bookId),
  accountId: String(row.accountId),
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

type DescriptorRow = typeof schema.paymentMovementDescriptors.$inferSelect;
const descriptorFromRow = (
  direction: MovementDirection,
  row: DescriptorRow,
): AccountMovementDescriptor => ({
  bookId: String(row.bookId),
  direction,
  accountId: String(row.accountId),
  descriptorKey: row.descriptorKey,
  name: row.name,
  ...mappingFromRow(row),
});

type MovementRow = typeof schema.paymentMovements.$inferSelect;
const movementFromRow = (
  direction: MovementDirection,
  row: MovementRow,
): AccountMovement => ({
  id: String(row.id),
  bookId: String(row.bookId),
  direction,
  accountId: String(row.accountId),
  fileId: String(row.fileId),
  externalId: row.externalId,
  occurredOn: row.occurredOn,
  occurredAt: row.occurredAt,
  amount: row.amount,
  currency: row.currency,
  name: row.name,
  descriptorKey: row.descriptorKey,
  description: row.description,
  promise: row.promise,
  ...mappingFromRow(row),
  status: row.status as MovementStatus,
  ignoreReason: row.ignoreReason,
});

type LinkRow = typeof schema.paymentMovementLinks.$inferSelect;
const linkFromRow = (
  direction: MovementDirection,
  row: LinkRow,
): AccountMovementLink => {
  const payment = direction === "PAYMENT";
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    direction,
    movementId: String(row.movementId),
    externalKey: row.externalKey,
    statementKey: row.statementKey,
    amount: row.amount,
    transferId: text(row.transferId),
    expenseId: payment ? text(row.entryId) : null,
    expenseKey: payment ? row.entryKey : null,
    paymentId: payment ? text(row.cashId) : null,
    paymentKey: payment ? row.cashKey : null,
    revenueId: payment ? null : text(row.entryId),
    revenueKey: payment ? null : row.entryKey,
    receiptId: payment ? null : text(row.cashId),
    receiptKey: payment ? null : row.cashKey,
  };
};

/* The two movement tables share an id sequence, so an id names one row. */
async function findMovement(
  handle: unknown,
  bookId: string,
  id: string,
): Promise<AccountMovement | null> {
  if (!isId(id)) return null;
  for (const direction of directions) {
    const table = movementTables[direction];
    const [row] = await on(handle)
      .select()
      .from(table)
      .where(and(eq(table.bookId, book(bookId)), eq(table.id, Number(id))));
    if (row) return movementFromRow(direction, row as MovementRow);
  }
  return null;
}

function descriptorWhere(bookId: string, ref: DescriptorRef) {
  const table = descriptorTables[ref.direction];
  return and(
    eq(table.bookId, book(bookId)),
    eq(table.accountId, idNumber(ref.accountId, "accountId")),
    eq(table.descriptorKey, ref.descriptorKey),
  );
}

export function createAccountMovementRepository(): AccountMovementPort {
  return {
    movementConsumers: {
      async get(handle, bookId, accountId, movementType) {
        if (!isId(accountId)) return null;
        const [row] = await on(handle)
          .select()
          .from(consumers)
          .where(
            and(
              eq(consumers.bookId, book(bookId)),
              eq(consumers.accountId, Number(accountId)),
              eq(consumers.movementType, movementType),
            ),
          );
        return row ? consumerFromRow(row) : null;
      },
      async set(handle, bookId, input) {
        const values = {
          bookId: book(bookId),
          accountId: idNumber(input.accountId, "accountId"),
          movementType: input.movementType,
          importerId: input.importerId,
          setBy: input.setBy,
        };
        return consumerFromRow(
          first(
            await on(handle)
              .insert(consumers)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  consumers.bookId,
                  consumers.accountId,
                  consumers.movementType,
                ],
                set: {
                  importerId: values.importerId,
                  setBy: values.setBy,
                  setAt: sql`now()`,
                },
              })
              .returning(),
            "statement consumer set",
          ),
        );
      },
      async list(handle, bookId, query) {
        const rows = await on(handle)
          .select()
          .from(consumers)
          .where(
            and(
              eq(consumers.bookId, book(bookId)),
              query.accountId
                ? eq(
                    consumers.accountId,
                    idNumber(query.accountId, "accountId"),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(consumers.accountId), asc(consumers.movementType));
        return rows.map(consumerFromRow);
      },
    },

    movementFiles: {
      async get(handle, bookId, id) {
        if (!isId(id)) return null;
        const [row] = await on(handle)
          .select()
          .from(files)
          .where(and(eq(files.bookId, book(bookId)), eq(files.id, Number(id))));
        return row ? fileFromRow(row) : null;
      },
      async findByContent(handle, bookId, query) {
        const [row] = await on(handle)
          .select()
          .from(files)
          .where(
            and(
              eq(files.bookId, book(bookId)),
              eq(files.accountId, idNumber(query.accountId, "accountId")),
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
              .values({
                ...input,
                bookId: book(bookId),
                accountId: idNumber(input.accountId, "accountId"),
              })
              .returning(),
            "statement file insert",
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
              query.accountId
                ? eq(files.accountId, idNumber(query.accountId, "accountId"))
                : undefined,
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

    accountMovementDescriptors: {
      async ensure(handle, bookId, input) {
        const table = descriptorTables[input.direction];
        await on(handle)
          .insert(table)
          .values({
            bookId: book(bookId),
            accountId: idNumber(input.accountId, "accountId"),
            descriptorKey: input.descriptorKey,
            name: input.name,
          })
          .onConflictDoNothing();
        const row = first(
          await on(handle)
            .select()
            .from(table)
            .where(descriptorWhere(bookId, input)),
          "descriptor ensure",
        );
        return descriptorFromRow(input.direction, row);
      },
      async get(handle, bookId, ref) {
        if (!isId(ref.accountId)) return null;
        const table = descriptorTables[ref.direction];
        const [row] = await on(handle)
          .select()
          .from(table)
          .where(descriptorWhere(bookId, ref));
        return row ? descriptorFromRow(ref.direction, row) : null;
      },
      async list(handle, bookId, query) {
        const found: AccountMovementDescriptor[] = [];
        for (const direction of directions) {
          if (query.direction && query.direction !== direction) continue;
          const table = descriptorTables[direction];
          const mapped = or(
            isNotNull(table.partyId),
            isNotNull(table.financialCategoryId),
            isNotNull(table.counterAccountId),
          );
          const rows = await on(handle)
            .select()
            .from(table)
            .where(
              and(
                eq(table.bookId, book(bookId)),
                query.accountId
                  ? eq(table.accountId, idNumber(query.accountId, "accountId"))
                  : undefined,
                query.classified === undefined
                  ? undefined
                  : query.classified
                    ? mapped
                    : and(
                        isNull(table.partyId),
                        isNull(table.financialCategoryId),
                        isNull(table.counterAccountId),
                      ),
              ),
            )
            .orderBy(asc(table.accountId), asc(table.descriptorKey));
          found.push(...rows.map((row) => descriptorFromRow(direction, row)));
        }
        return found;
      },
      async classify(handle, bookId, ref, mapping) {
        const table = descriptorTables[ref.direction];
        const row = first(
          await on(handle)
            .update(table)
            .set(mappingValues(mapping))
            .where(descriptorWhere(bookId, ref))
            .returning(),
          "descriptor classify",
        );
        return descriptorFromRow(ref.direction, row);
      },
    },

    accountMovements: {
      async findByExternalIds(handle, bookId, accountId, externalIds) {
        if (externalIds.length === 0) return [];
        const found: AccountMovement[] = [];
        for (const direction of directions) {
          const table = movementTables[direction];
          const rows = await on(handle)
            .select()
            .from(table)
            .where(
              and(
                eq(table.bookId, book(bookId)),
                eq(table.accountId, idNumber(accountId, "accountId")),
                inArray(table.externalId, [...externalIds]),
              ),
            );
          found.push(
            ...rows.map((row) =>
              movementFromRow(direction, row as MovementRow),
            ),
          );
        }
        return found;
      },
      async insert(handle, bookId, input) {
        const table = movementTables[input.direction];
        const row = first(
          await on(handle)
            .insert(table)
            .values({
              bookId: book(bookId),
              accountId: idNumber(input.accountId, "accountId"),
              fileId: idNumber(input.fileId, "fileId"),
              externalId: input.externalId,
              occurredOn: input.occurredOn,
              occurredAt: input.occurredAt,
              amount: input.amount,
              currency: input.currency,
              name: input.name,
              descriptorKey: input.descriptorKey,
              description: input.description,
              promise: input.promise,
              ...mappingValues(input),
            })
            .returning(),
          "movement insert",
        );
        return movementFromRow(input.direction, row as MovementRow);
      },
      get: findMovement,
      async list(handle, bookId, query) {
        const rows: AccountMovement[] = [];
        for (const direction of directions) {
          if (query.direction && query.direction !== direction) continue;
          const table = movementTables[direction];
          const conditions: (SQL | undefined)[] = [
            eq(table.bookId, book(bookId)),
            query.accountId
              ? eq(table.accountId, idNumber(query.accountId, "accountId"))
              : undefined,
            query.status ? eq(table.status, query.status) : undefined,
            query.descriptorKey
              ? eq(table.descriptorKey, query.descriptorKey)
              : undefined,
            query.after
              ? lt(table.id, idNumber(query.after, "cursor"))
              : undefined,
          ];
          const found = await on(handle)
            .select()
            .from(table)
            .where(and(...conditions))
            .orderBy(desc(table.id))
            .limit(query.limit);
          rows.push(
            ...found.map((row) =>
              movementFromRow(direction, row as MovementRow),
            ),
          );
        }
        // Newest id first across both tables; ids come from one sequence.
        return rows
          .sort((a, b) => Number(b.id) - Number(a.id))
          .slice(0, query.limit);
      },
      async update(handle, bookId, id, patch) {
        const known = await findMovement(handle, bookId, id);
        if (!known) throw new Error(`movement ${id} not found`);
        const table = movementTables[known.direction];
        const values: Record<string, unknown> = mappingValues(patch);
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.ignoreReason !== undefined)
          values.ignoreReason = patch.ignoreReason;
        const row = first(
          await on(handle)
            .update(table)
            .set(values)
            .where(
              and(eq(table.bookId, book(bookId)), eq(table.id, Number(id))),
            )
            .returning(),
          "movement update",
        );
        return movementFromRow(known.direction, row as MovementRow);
      },
      async lock(handle, bookId, id) {
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${`movement:${bookId}:${id}`}))`,
        );
      },
    },

    accountMovementLinks: {
      async insert(handle, bookId, input) {
        const table = linkTables[input.direction];
        const payment = input.direction === "PAYMENT";
        const row = first(
          await on(handle)
            .insert(table)
            .values({
              bookId: book(bookId),
              movementId: idNumber(input.movementId, "movementId"),
              externalKey: input.externalKey,
              entryKey: payment ? input.expenseKey : input.revenueKey,
              cashKey: payment ? input.paymentKey : input.receiptKey,
              statementKey: input.statementKey,
              amount: input.amount,
              transferId: number(input.transferId, "transferId"),
              entryId: number(
                payment ? input.expenseId : input.revenueId,
                "entryId",
              ),
              cashId: number(
                payment ? input.paymentId : input.receiptId,
                "cashId",
              ),
            })
            .returning(),
          "movement link insert",
        );
        return linkFromRow(input.direction, row as LinkRow);
      },
      async list(handle, bookId, query) {
        const found: AccountMovementLink[] = [];
        if (query.movementId && !isId(query.movementId)) return [];
        if (query.transferId && !isId(query.transferId)) return [];
        for (const direction of directions) {
          const table = linkTables[direction];
          const rows = await on(handle)
            .select()
            .from(table)
            .where(
              and(
                eq(table.bookId, book(bookId)),
                query.movementId
                  ? eq(table.movementId, Number(query.movementId))
                  : undefined,
                query.statementKey
                  ? eq(table.statementKey, query.statementKey)
                  : undefined,
                query.externalKey
                  ? eq(table.externalKey, query.externalKey)
                  : undefined,
                query.entryKey ? eq(table.entryKey, query.entryKey) : undefined,
                query.cashKey ? eq(table.cashKey, query.cashKey) : undefined,
                query.transferId
                  ? eq(table.transferId, Number(query.transferId))
                  : undefined,
              ),
            )
            .orderBy(asc(table.id));
          found.push(
            ...rows.map((row) => linkFromRow(direction, row as LinkRow)),
          );
        }
        return found;
      },
      async removeOfMovement(handle, bookId, movementId) {
        for (const direction of directions) {
          const table = linkTables[direction];
          await on(handle)
            .delete(table)
            .where(
              and(
                eq(table.bookId, book(bookId)),
                eq(table.movementId, idNumber(movementId, "movementId")),
              ),
            );
        }
      },
    },
  };
}
