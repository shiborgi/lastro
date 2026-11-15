/** Card movement evidence's PostgreSQL adapter (ADR 18). */
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
import type { CardPort } from "../application/port";
import type { MovementStatus } from "../domain/account-movements";
import type {
  CardDescriptor,
  CardExpenseLink,
  CardMovement,
  CardPaymentLink,
  CardTransferLink,
} from "../domain/cards";
import type { PaymentMethod } from "../domain/records";
import {
  cardMovementDescriptors as descriptors,
  cardMovementExpenses as expenseLinks,
  cardMovements as movements,
  cardMovementPayments as paymentLinks,
  cardMovementTransfers as transferLinks,
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
): CardDescriptor => ({
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  descriptorKey: row.descriptorKey,
  name: row.name,
  partyId: text(row.partyId),
  financialCategoryId: text(row.financialCategoryId),
  counterAccountId: text(row.counterAccountId),
  paymentMethod: row.paymentMethod as PaymentMethod | null,
});

const movementFromRow = (row: typeof movements.$inferSelect): CardMovement => ({
  id: String(row.id),
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  fileId: String(row.fileId),
  statementId: row.statementId,
  externalId: row.externalId,
  paymentKey: row.paymentKey,
  expenseKey: row.expenseKey,
  occurredOn: row.occurredOn,
  amount: row.amount,
  currency: row.currency,
  name: row.name,
  descriptorKey: row.descriptorKey,
  description: row.description,
  cardholder: row.cardholder,
  cardLast4: row.cardLast4,
  providerCategory: row.providerCategory,
  installmentNumber: row.installmentNumber,
  installmentCount: row.installmentCount,
  partyId: text(row.partyId),
  financialCategoryId: text(row.financialCategoryId),
  counterAccountId: text(row.counterAccountId),
  paymentMethod: row.paymentMethod as PaymentMethod | null,
  status: row.status as MovementStatus,
  ignoreReason: row.ignoreReason,
});

const expenseFromRow = (
  row: typeof expenseLinks.$inferSelect,
): CardExpenseLink => ({
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  expenseKey: row.expenseKey,
  expenseId: String(row.expenseId),
});

const paymentFromRow = (
  row: typeof paymentLinks.$inferSelect,
): CardPaymentLink => ({
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  paymentKey: row.paymentKey,
  expenseKey: row.expenseKey,
  installmentNumber: row.installmentNumber,
  installmentCount: row.installmentCount,
  paymentId: String(row.paymentId),
  settlementId: String(row.settlementId),
  movementId: text(row.movementId),
});

const transferFromRow = (
  row: typeof transferLinks.$inferSelect,
): CardTransferLink => ({
  bookId: String(row.bookId),
  accountId: String(row.accountId),
  movementId: String(row.movementId),
  externalKey: row.externalKey,
  statementKey: row.statementKey,
  transferId: String(row.transferId),
});

const descriptorWhere = (bookId: string, accountId: string, key: string) =>
  and(
    eq(descriptors.bookId, book(bookId)),
    eq(descriptors.accountId, idNumber(accountId, "accountId")),
    eq(descriptors.descriptorKey, key),
  );

const paymentWhere = (bookId: string, accountId: string, key: string) =>
  and(
    eq(paymentLinks.bookId, book(bookId)),
    eq(paymentLinks.accountId, idNumber(accountId, "accountId")),
    eq(paymentLinks.paymentKey, key),
  );

async function paymentsOf(
  handle: unknown,
  bookId: string,
  accountId: string,
  expenseKey: string,
): Promise<CardPaymentLink[]> {
  const rows = await on(handle)
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.bookId, book(bookId)),
        eq(paymentLinks.accountId, idNumber(accountId, "accountId")),
        eq(paymentLinks.expenseKey, expenseKey),
      ),
    )
    .orderBy(asc(paymentLinks.installmentNumber));
  return rows.map(paymentFromRow);
}

export function createCardRepository(): CardPort {
  return {
    cardDescriptors: {
      async ensure(handle, bookId, input) {
        await on(handle)
          .insert(descriptors)
          .values({
            bookId: book(bookId),
            accountId: idNumber(input.accountId, "accountId"),
            descriptorKey: input.descriptorKey,
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
            "card descriptor ensure",
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
                counterAccountId: number(
                  input.counterAccountId,
                  "counterAccountId",
                ),
                paymentMethod: input.paymentMethod,
              })
              .where(
                descriptorWhere(bookId, input.accountId, input.descriptorKey),
              )
              .returning(),
            "card descriptor classify",
          ),
        );
      },
    },

    cardMovements: {
      async findByStatementIds(handle, bookId, accountId, statementIds) {
        if (statementIds.length === 0) return [];
        const rows = await on(handle)
          .select()
          .from(movements)
          .where(
            and(
              eq(movements.bookId, book(bookId)),
              eq(movements.accountId, idNumber(accountId, "accountId")),
              inArray(movements.statementId, [...statementIds]),
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
                partyId: number(input.partyId, "partyId"),
                financialCategoryId: number(
                  input.financialCategoryId,
                  "financialCategoryId",
                ),
                counterAccountId: number(
                  input.counterAccountId,
                  "counterAccountId",
                ),
              })
              .returning(),
            "card movement insert",
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
              query.descriptorKey
                ? eq(movements.descriptorKey, query.descriptorKey)
                : undefined,
              query.expenseKey
                ? eq(movements.expenseKey, query.expenseKey)
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
        if (patch.partyId !== undefined)
          values.partyId = number(patch.partyId, "partyId");
        if (patch.financialCategoryId !== undefined)
          values.financialCategoryId = number(
            patch.financialCategoryId,
            "financialCategoryId",
          );
        if (patch.counterAccountId !== undefined)
          values.counterAccountId = number(
            patch.counterAccountId,
            "counterAccountId",
          );
        if (patch.paymentMethod !== undefined)
          values.paymentMethod = patch.paymentMethod;
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
            "card movement update",
          ),
        );
      },
      async lock(handle, bookId, id) {
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${`card-movement:${bookId}:${id}`}))`,
        );
      },
    },

    cardLinks: {
      async getExpense(handle, bookId, accountId, expenseKey) {
        const [row] = await on(handle)
          .select()
          .from(expenseLinks)
          .where(
            and(
              eq(expenseLinks.bookId, book(bookId)),
              eq(expenseLinks.accountId, idNumber(accountId, "accountId")),
              eq(expenseLinks.expenseKey, expenseKey),
            ),
          );
        return row ? expenseFromRow(row) : null;
      },
      async insertExpense(handle, bookId, input) {
        return expenseFromRow(
          first(
            await on(handle)
              .insert(expenseLinks)
              .values({
                bookId: book(bookId),
                accountId: idNumber(input.accountId, "accountId"),
                expenseKey: input.expenseKey,
                expenseId: idNumber(input.expenseId, "expenseId"),
              })
              .returning(),
            "card expense link insert",
          ),
        );
      },
      async removeExpense(handle, bookId, accountId, expenseKey) {
        const account = idNumber(accountId, "accountId");
        await on(handle)
          .delete(paymentLinks)
          .where(
            and(
              eq(paymentLinks.bookId, book(bookId)),
              eq(paymentLinks.accountId, account),
              eq(paymentLinks.expenseKey, expenseKey),
            ),
          );
        await on(handle)
          .delete(expenseLinks)
          .where(
            and(
              eq(expenseLinks.bookId, book(bookId)),
              eq(expenseLinks.accountId, account),
              eq(expenseLinks.expenseKey, expenseKey),
            ),
          );
      },
      async insertPayment(handle, bookId, input) {
        return paymentFromRow(
          first(
            await on(handle)
              .insert(paymentLinks)
              .values({
                bookId: book(bookId),
                accountId: idNumber(input.accountId, "accountId"),
                paymentKey: input.paymentKey,
                expenseKey: input.expenseKey,
                installmentNumber: input.installmentNumber,
                installmentCount: input.installmentCount,
                paymentId: idNumber(input.paymentId, "paymentId"),
                settlementId: idNumber(input.settlementId, "settlementId"),
                movementId: number(input.movementId, "movementId"),
              })
              .returning(),
            "card payment link insert",
          ),
        );
      },
      async getPayment(handle, bookId, accountId, paymentKey) {
        const [row] = await on(handle)
          .select()
          .from(paymentLinks)
          .where(paymentWhere(bookId, accountId, paymentKey));
        return row ? paymentFromRow(row) : null;
      },
      async setPaymentMovement(
        handle,
        bookId,
        accountId,
        paymentKey,
        movementId,
      ) {
        return paymentFromRow(
          first(
            await on(handle)
              .update(paymentLinks)
              .set({ movementId: number(movementId, "movementId") })
              .where(paymentWhere(bookId, accountId, paymentKey))
              .returning(),
            "card payment link update",
          ),
        );
      },
      paymentsOf,
      async list(handle, bookId, query) {
        const expenseRows = await on(handle)
          .select()
          .from(expenseLinks)
          .where(
            and(
              eq(expenseLinks.bookId, book(bookId)),
              query.accountId
                ? eq(
                    expenseLinks.accountId,
                    idNumber(query.accountId, "accountId"),
                  )
                : undefined,
              query.expenseKey
                ? eq(expenseLinks.expenseKey, query.expenseKey)
                : undefined,
              query.expenseId
                ? eq(
                    expenseLinks.expenseId,
                    idNumber(query.expenseId, "expenseId"),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(expenseLinks.expenseId));
        const found = expenseRows.map(expenseFromRow);
        const payments: CardPaymentLink[] = [];
        for (const each of found)
          payments.push(
            ...(await paymentsOf(
              handle,
              bookId,
              each.accountId,
              each.expenseKey,
            )),
          );
        return { expenses: found, payments };
      },
      async insertTransfer(handle, bookId, input) {
        return transferFromRow(
          first(
            await on(handle)
              .insert(transferLinks)
              .values({
                bookId: book(bookId),
                accountId: idNumber(input.accountId, "accountId"),
                movementId: idNumber(input.movementId, "movementId"),
                externalKey: input.externalKey,
                statementKey: input.statementKey,
                transferId: idNumber(input.transferId, "transferId"),
              })
              .returning(),
            "card transfer link insert",
          ),
        );
      },
      async transfers(handle, bookId, query) {
        if (query.movementId && !isId(query.movementId)) return [];
        if (query.transferId && !isId(query.transferId)) return [];
        const rows = await on(handle)
          .select()
          .from(transferLinks)
          .where(
            and(
              eq(transferLinks.bookId, book(bookId)),
              query.movementId
                ? eq(transferLinks.movementId, Number(query.movementId))
                : undefined,
              query.statementKey
                ? eq(transferLinks.statementKey, query.statementKey)
                : undefined,
              query.transferId
                ? eq(transferLinks.transferId, Number(query.transferId))
                : undefined,
            ),
          )
          .orderBy(asc(transferLinks.movementId));
        return rows.map(transferFromRow);
      },
      async removeTransfer(handle, bookId, movementId) {
        await on(handle)
          .delete(transferLinks)
          .where(
            and(
              eq(transferLinks.bookId, book(bookId)),
              eq(transferLinks.movementId, idNumber(movementId, "movementId")),
            ),
          );
      },
      async lock(handle, bookId, accountId, expenseKey) {
        await on(handle).execute(
          sql`select pg_advisory_xact_lock(hashtext(${`card-purchase:${bookId}:${accountId}:${expenseKey}`}))`,
        );
      },
    },
  };
}
