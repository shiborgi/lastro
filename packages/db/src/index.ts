import {
  type Account,
  type AuditEvent,
  type Book,
  type Expense,
  type ExpenseCategory,
  type Party,
  type Receipt,
  type Revenue,
  type RevenueCategory,
  type RevenueSettlement,
  type Role,
  type Transfer,
  roles,
} from "@lastro/domain";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const clients = new WeakMap<object, postgres.Sql>();

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client, { schema });
  clients.set(database, client);
  return database;
}

export type Database = ReturnType<typeof createDb>;

export async function closeDb(db: Database): Promise<void> {
  await clients.get(db)?.end({ timeout: 5 });
}

function bookNumber(bookId: string): number {
  if (!/^\d+$/.test(bookId) || Number(bookId) < 1) {
    throw new Error("bookId must be a positive integer");
  }
  return Number(bookId);
}

function accountFromRow(row: typeof schema.accounts.$inferSelect): Account {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    name: row.name,
    type: row.type,
    createdAt: row.createdAt,
  };
}

function partyFromRow(row: typeof schema.parties.$inferSelect): Party {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    name: row.name,
    type: row.type,
    createdAt: row.createdAt,
  };
}

function expenseCategoryFromRow(
  row: typeof schema.expenseCategories.$inferSelect,
): ExpenseCategory {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    name: row.name,
    createdAt: row.createdAt,
  };
}

function revenueCategoryFromRow(
  row: typeof schema.revenueCategories.$inferSelect,
): RevenueCategory {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    name: row.name,
    createdAt: row.createdAt,
  };
}

function expenseFromRow(row: typeof schema.expenses.$inferSelect): Expense {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    partyId: String(row.partyId),
    expenseCategoryId: String(row.expenseCategoryId),
    amountMinor: row.amountMinor,
    currency: row.currency,
    installmentNumber: row.installmentNumber,
    installmentCount: row.installmentCount,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function paymentFromRow(row: typeof schema.payments.$inferSelect) {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    partyId: row.partyId === null ? null : String(row.partyId),
    amountMinor: row.amountMinor,
    currency: row.currency,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function settlementFromRow(row: typeof schema.expenseSettlements.$inferSelect) {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    expenseId: String(row.expenseId),
    paymentId: String(row.paymentId),
    amountMinor: row.amountMinor,
    currency: row.currency,
    voidedAt: row.voidedAt,
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
  };
}

function revenueFromRow(row: typeof schema.revenues.$inferSelect): Revenue {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    partyId: String(row.partyId),
    revenueCategoryId: String(row.revenueCategoryId),
    amountMinor: row.amountMinor,
    currency: row.currency,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function receiptFromRow(row: typeof schema.receipts.$inferSelect): Receipt {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    partyId: row.partyId === null ? null : String(row.partyId),
    amountMinor: row.amountMinor,
    currency: row.currency,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function revenueSettlementFromRow(
  row: typeof schema.revenueSettlements.$inferSelect,
): RevenueSettlement {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    revenueId: String(row.revenueId),
    receiptId: String(row.receiptId),
    amountMinor: row.amountMinor,
    currency: row.currency,
    voidedAt: row.voidedAt,
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
  };
}

function transferFromRow(row: typeof schema.transfers.$inferSelect): Transfer {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    sourcePaymentId: String(row.sourcePaymentId),
    destinationReceiptId: String(row.destinationReceiptId),
    correlationId: row.correlationId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    createdAt: row.createdAt,
  };
}

function importedMovementFromRow(
  row: typeof schema.importedMovements.$inferSelect,
) {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    externalReference: row.externalReference,
    kind: row.kind as "DEBIT" | "CREDIT",
    amountMinor: row.amountMinor,
    currency: row.currency,
    occurredAt: row.occurredAt,
    status: row.status as "REVIEW" | "CONVERTED" | "UNCHANGED",
    createdAt: row.createdAt,
  };
}

function jobFromRow(row: typeof schema.jobs.$inferSelect) {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    type: row.type,
    payload: row.payload,
    status: row.status as "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED",
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt,
    leasedBy: row.leasedBy,
    leasedUntil: row.leasedUntil,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function auditValues(audit: AuditEvent, resourceId?: string) {
  return {
    actorType: audit.actorType,
    actorPrincipal: audit.actorPrincipal,
    delegatedOperator: audit.delegatedOperator,
    bookId: bookNumber(audit.bookId),
    source: audit.source,
    correlationId: audit.correlationId,
    action: audit.action,
    resourceType: audit.resourceType,
    resourceId: resourceId ?? audit.resourceId,
    payload: audit.payload ?? {},
  };
}

function bookFromRow(row: typeof schema.books.$inferSelect): Book {
  return { id: String(row.id), name: row.name, createdAt: row.createdAt };
}

function roleFromValue(value: string): Role | null {
  return roles.includes(value as Role) ? (value as Role) : null;
}

export function createRepositories(db: Database) {
  const repository = {
    async createUser(input: { id: string; email: string; name: string }) {
      const [row] = await db.insert(schema.users).values(input).returning();
      return row;
    },

    async createBook(name: string): Promise<Book> {
      const [row] = await db.insert(schema.books).values({ name }).returning();
      return bookFromRow(row);
    },

    async addBookMember(input: {
      bookId: string;
      userId: string;
      role: Role;
    }): Promise<void> {
      await db.insert(schema.bookMembers).values({
        bookId: bookNumber(input.bookId),
        userId: input.userId,
        role: input.role,
      });
    },

    async listBooks(actorId: string, bookId?: string): Promise<Book[]> {
      const memberBook = eq(schema.bookMembers.bookId, schema.books.id);
      const rows = await db
        .select({ book: schema.books })
        .from(schema.books)
        .innerJoin(schema.bookMembers, memberBook)
        .where(
          and(
            eq(schema.bookMembers.userId, actorId),
            bookId === undefined
              ? undefined
              : eq(schema.books.id, bookNumber(bookId)),
          ),
        );
      return rows.map(({ book }) => bookFromRow(book));
    },

    async createAccount(
      input: Omit<Account, "id">,
      audit: AuditEvent,
    ): Promise<Account> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.accounts)
          .values({
            bookId: bookNumber(input.bookId),
            name: input.name,
            type: input.type,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountFromRow(row);
      });
    },

    async listAccounts(bookId: string): Promise<Account[]> {
      const rows = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.bookId, bookNumber(bookId)));
      return rows.map(accountFromRow);
    },

    async deleteAccount(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.accounts)
          .where(
            and(
              eq(schema.accounts.bookId, bookNumber(bookId)),
              eq(schema.accounts.id, Number(id)),
            ),
          )
          .returning({ id: schema.accounts.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async createParty(
      input: Omit<Party, "id">,
      audit: AuditEvent,
    ): Promise<Party> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.parties)
          .values({
            bookId: bookNumber(input.bookId),
            name: input.name,
            type: input.type,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return partyFromRow(row);
      });
    },

    async listParties(bookId: string): Promise<Party[]> {
      const rows = await db
        .select()
        .from(schema.parties)
        .where(eq(schema.parties.bookId, bookNumber(bookId)));
      return rows.map(partyFromRow);
    },

    async deleteParty(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.parties)
          .where(
            and(
              eq(schema.parties.bookId, bookNumber(bookId)),
              eq(schema.parties.id, Number(id)),
            ),
          )
          .returning({ id: schema.parties.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async createExpenseCategory(
      input: Omit<ExpenseCategory, "id">,
      audit: AuditEvent,
    ): Promise<ExpenseCategory> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.expenseCategories)
          .values({ bookId: bookNumber(input.bookId), name: input.name })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return expenseCategoryFromRow(row);
      });
    },

    async listExpenseCategories(bookId: string): Promise<ExpenseCategory[]> {
      const rows = await db
        .select()
        .from(schema.expenseCategories)
        .where(eq(schema.expenseCategories.bookId, bookNumber(bookId)));
      return rows.map(expenseCategoryFromRow);
    },

    async deleteExpenseCategory(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.expenseCategories)
          .where(
            and(
              eq(schema.expenseCategories.bookId, bookNumber(bookId)),
              eq(schema.expenseCategories.id, Number(id)),
            ),
          )
          .returning({ id: schema.expenseCategories.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async createRevenueCategory(
      input: Omit<RevenueCategory, "id">,
      audit: AuditEvent,
    ): Promise<RevenueCategory> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.revenueCategories)
          .values({ bookId: bookNumber(input.bookId), name: input.name })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return revenueCategoryFromRow(row);
      });
    },

    async listRevenueCategories(bookId: string): Promise<RevenueCategory[]> {
      const rows = await db
        .select()
        .from(schema.revenueCategories)
        .where(eq(schema.revenueCategories.bookId, bookNumber(bookId)));
      return rows.map(revenueCategoryFromRow);
    },

    async createExpense(
      input: Omit<Expense, "id"> & { idempotencyKey?: string },
      audit: AuditEvent,
    ): Promise<Expense> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "expense.create")
              throw new Error(
                "idempotency key was already used for another operation",
              );
            const [expense] = await tx
              .select()
              .from(schema.expenses)
              .where(
                and(
                  eq(schema.expenses.bookId, bookId),
                  eq(schema.expenses.id, Number(existing.resourceId)),
                ),
              );
            if (!expense)
              throw new Error("idempotency record references no expense");
            return expenseFromRow(expense);
          }
        }
        const [row] = await tx
          .insert(schema.expenses)
          .values({
            bookId,
            accountId: Number(input.accountId),
            partyId: Number(input.partyId),
            expenseCategoryId: Number(input.expenseCategoryId),
            amountMinor: input.amountMinor,
            currency: input.currency,
            installmentNumber: input.installmentNumber,
            installmentCount: input.installmentCount,
            occurredAt: input.occurredAt,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "expense.create",
            resourceType: "expense",
            resourceId: String(row.id),
          });
        }
        return expenseFromRow(row);
      });
    },

    async listExpenses(bookId: string): Promise<Expense[]> {
      const rows = await db
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.bookId, bookNumber(bookId)));
      return rows.map(expenseFromRow);
    },

    async getExpense(bookId: string, id: string) {
      const [row] = await db
        .select()
        .from(schema.expenses)
        .where(
          and(
            eq(schema.expenses.bookId, bookNumber(bookId)),
            eq(schema.expenses.id, Number(id)),
          ),
        );
      if (!row) return null;
      return {
        ...expenseFromRow(row),
        amountMinor: row.amountMinor,
        currency: row.currency,
      };
    },

    async listPendingExpenses(bookId: string) {
      const rows = await db
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.bookId, bookNumber(bookId)));
      return rows.map((row) => ({
        ...expenseFromRow(row),
        amountMinor: row.amountMinor,
        currency: row.currency,
      }));
    },

    async createPayment(
      input: {
        bookId: string;
        accountId: string;
        partyId?: string | null;
        amountMinor: bigint;
        currency: string;
        occurredAt?: Date;
        idempotencyKey?: string;
      },
      audit: AuditEvent,
    ) {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "payment.create") {
              throw new Error(
                "idempotency key was already used for another operation",
              );
            }
            const [payment] = await tx
              .select()
              .from(schema.payments)
              .where(
                and(
                  eq(schema.payments.bookId, bookId),
                  eq(schema.payments.id, Number(existing.resourceId)),
                ),
              );
            if (!payment)
              throw new Error("idempotency record references no payment");
            return paymentFromRow(payment);
          }
        }
        const [payment] = await tx
          .insert(schema.payments)
          .values({
            bookId,
            accountId: Number(input.accountId),
            partyId: input.partyId == null ? null : Number(input.partyId),
            amountMinor: input.amountMinor,
            currency: input.currency,
            occurredAt: input.occurredAt,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(payment.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "payment.create",
            resourceType: "payment",
            resourceId: String(payment.id),
          });
        }
        return paymentFromRow(payment);
      });
    },

    async listPayments(bookId: string) {
      const rows = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.bookId, bookNumber(bookId)));
      return rows.map(paymentFromRow);
    },

    async createExpenseSettlement(
      input: {
        bookId: string;
        expenseId: string;
        paymentId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey?: string;
      },
      audit: AuditEvent,
    ) {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        // Serialize allocations affecting either balance before constraint checks run.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`expense:${bookId}:${input.expenseId}`}))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`payment:${bookId}:${input.paymentId}`}))`,
        );
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "expense_settlement.create") {
              throw new Error(
                "idempotency key was already used for another operation",
              );
            }
            const [settlement] = await tx
              .select()
              .from(schema.expenseSettlements)
              .where(
                and(
                  eq(schema.expenseSettlements.bookId, bookId),
                  eq(schema.expenseSettlements.id, Number(existing.resourceId)),
                ),
              );
            if (!settlement) {
              throw new Error("idempotency record references no settlement");
            }
            return settlementFromRow(settlement);
          }
        }
        const [settlement] = await tx
          .insert(schema.expenseSettlements)
          .values({
            bookId,
            expenseId: Number(input.expenseId),
            paymentId: Number(input.paymentId),
            amountMinor: input.amountMinor,
            currency: input.currency,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(settlement.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "expense_settlement.create",
            resourceType: "expense_settlement",
            resourceId: String(settlement.id),
          });
        }
        return settlementFromRow(settlement);
      });
    },

    async voidExpenseSettlement(
      input: {
        bookId: string;
        id: string;
        voidedBy: string;
        voidReason?: string;
      },
      audit: AuditEvent,
    ) {
      return db.transaction(async (tx) => {
        const [settlement] = await tx
          .update(schema.expenseSettlements)
          .set({
            voidedAt: new Date(),
            voidedBy: input.voidedBy,
            voidReason: input.voidReason,
          })
          .where(
            and(
              eq(schema.expenseSettlements.bookId, bookNumber(input.bookId)),
              eq(schema.expenseSettlements.id, Number(input.id)),
              sql`${schema.expenseSettlements.voidedAt} is null`,
            ),
          )
          .returning();
        if (!settlement) throw new Error("active settlement was not found");
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(settlement.id)));
        return settlementFromRow(settlement);
      });
    },

    async listExpenseSettlements(bookId: string, expenseId?: string) {
      const rows = await db
        .select()
        .from(schema.expenseSettlements)
        .where(
          and(
            eq(schema.expenseSettlements.bookId, bookNumber(bookId)),
            expenseId === undefined
              ? undefined
              : eq(schema.expenseSettlements.expenseId, Number(expenseId)),
          ),
        );
      return rows.map(settlementFromRow);
    },

    async listAuditEvents(correlationId: string) {
      return db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.correlationId, correlationId));
    },

    async createRevenue(
      input: {
        bookId: string;
        accountId: string;
        partyId: string;
        revenueCategoryId: string;
        amountMinor: bigint;
        currency: string;
        occurredAt?: Date;
        idempotencyKey?: string;
      },
      audit: AuditEvent,
    ): Promise<Revenue> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "revenue.create")
              throw new Error(
                "idempotency key was already used for another operation",
              );
            const [revenue] = await tx
              .select()
              .from(schema.revenues)
              .where(
                and(
                  eq(schema.revenues.bookId, bookId),
                  eq(schema.revenues.id, Number(existing.resourceId)),
                ),
              );
            if (!revenue)
              throw new Error("idempotency record references no revenue");
            return revenueFromRow(revenue);
          }
        }
        const [row] = await tx
          .insert(schema.revenues)
          .values({
            bookId,
            accountId: Number(input.accountId),
            partyId: Number(input.partyId),
            revenueCategoryId: Number(input.revenueCategoryId),
            amountMinor: input.amountMinor,
            currency: input.currency,
            occurredAt: input.occurredAt,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "revenue.create",
            resourceType: "revenue",
            resourceId: String(row.id),
          });
        }
        return revenueFromRow(row);
      });
    },

    async listRevenues(bookId: string): Promise<Revenue[]> {
      const rows = await db
        .select()
        .from(schema.revenues)
        .where(eq(schema.revenues.bookId, bookNumber(bookId)));
      return rows.map(revenueFromRow);
    },

    async getRevenue(bookId: string, id: string) {
      const [row] = await db
        .select()
        .from(schema.revenues)
        .where(
          and(
            eq(schema.revenues.bookId, bookNumber(bookId)),
            eq(schema.revenues.id, Number(id)),
          ),
        );
      if (!row) return null;
      return {
        ...revenueFromRow(row),
        amountMinor: row.amountMinor,
        currency: row.currency,
      };
    },

    async listPendingRevenues(bookId: string) {
      const rows = await db
        .select()
        .from(schema.revenues)
        .where(eq(schema.revenues.bookId, bookNumber(bookId)));
      return rows.map((row) => ({
        ...revenueFromRow(row),
        amountMinor: row.amountMinor,
        currency: row.currency,
      }));
    },

    async createReceipt(
      input: {
        bookId: string;
        accountId: string;
        partyId?: string | null;
        amountMinor: bigint;
        currency: string;
        occurredAt?: Date;
        idempotencyKey?: string;
      },
      audit: AuditEvent,
    ): Promise<Receipt> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "receipt.create")
              throw new Error(
                "idempotency key was already used for another operation",
              );
            const [receipt] = await tx
              .select()
              .from(schema.receipts)
              .where(
                and(
                  eq(schema.receipts.bookId, bookId),
                  eq(schema.receipts.id, Number(existing.resourceId)),
                ),
              );
            if (!receipt)
              throw new Error("idempotency record references no receipt");
            return receiptFromRow(receipt);
          }
        }
        const [row] = await tx
          .insert(schema.receipts)
          .values({
            bookId,
            accountId: Number(input.accountId),
            partyId: input.partyId == null ? null : Number(input.partyId),
            amountMinor: input.amountMinor,
            currency: input.currency,
            occurredAt: input.occurredAt,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "receipt.create",
            resourceType: "receipt",
            resourceId: String(row.id),
          });
        }
        return receiptFromRow(row);
      });
    },

    async listReceipts(bookId: string): Promise<Receipt[]> {
      const rows = await db
        .select()
        .from(schema.receipts)
        .where(eq(schema.receipts.bookId, bookNumber(bookId)));
      return rows.map(receiptFromRow);
    },

    async createRevenueSettlement(
      input: {
        bookId: string;
        revenueId: string;
        receiptId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey?: string;
      },
      audit: AuditEvent,
    ): Promise<RevenueSettlement> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`revenue:${bookId}:${input.revenueId}`}))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`receipt:${bookId}:${input.receiptId}`}))`,
        );
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "revenue_settlement.create") {
              throw new Error(
                "idempotency key was already used for another operation",
              );
            }
            const [settlement] = await tx
              .select()
              .from(schema.revenueSettlements)
              .where(
                and(
                  eq(schema.revenueSettlements.bookId, bookId),
                  eq(schema.revenueSettlements.id, Number(existing.resourceId)),
                ),
              );
            if (!settlement) {
              throw new Error("idempotency record references no settlement");
            }
            return revenueSettlementFromRow(settlement);
          }
        }
        const [row] = await tx
          .insert(schema.revenueSettlements)
          .values({
            bookId,
            revenueId: Number(input.revenueId),
            receiptId: Number(input.receiptId),
            amountMinor: input.amountMinor,
            currency: input.currency,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "revenue_settlement.create",
            resourceType: "revenue_settlement",
            resourceId: String(row.id),
          });
        }
        return revenueSettlementFromRow(row);
      });
    },

    async voidRevenueSettlement(
      input: {
        bookId: string;
        id: string;
        voidedBy: string;
        voidReason?: string;
      },
      audit: AuditEvent,
    ): Promise<RevenueSettlement> {
      return db.transaction(async (tx) => {
        const [settlement] = await tx
          .update(schema.revenueSettlements)
          .set({
            voidedAt: new Date(),
            voidedBy: input.voidedBy,
            voidReason: input.voidReason,
          })
          .where(
            and(
              eq(schema.revenueSettlements.bookId, bookNumber(input.bookId)),
              eq(schema.revenueSettlements.id, Number(input.id)),
              sql`${schema.revenueSettlements.voidedAt} is null`,
            ),
          )
          .returning();
        if (!settlement) throw new Error("active settlement was not found");
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(settlement.id)));
        return revenueSettlementFromRow(settlement);
      });
    },

    async listRevenueSettlements(bookId: string, revenueId?: string) {
      const rows = await db
        .select()
        .from(schema.revenueSettlements)
        .where(
          and(
            eq(schema.revenueSettlements.bookId, bookNumber(bookId)),
            revenueId === undefined
              ? undefined
              : eq(schema.revenueSettlements.revenueId, Number(revenueId)),
          ),
        );
      return rows.map(revenueSettlementFromRow);
    },

    async createTransfer(
      input: {
        bookId: string;
        sourceAccountId: string;
        destinationAccountId: string;
        amountMinor: bigint;
        currency: string;
        idempotencyKey?: string;
      },
      audit: AuditEvent,
    ): Promise<Transfer> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        if (input.idempotencyKey) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${bookId}:${input.idempotencyKey}`}))`,
          );
          const [existing] = await tx
            .select()
            .from(schema.idempotencyRecords)
            .where(
              and(
                eq(schema.idempotencyRecords.bookId, bookId),
                eq(schema.idempotencyRecords.key, input.idempotencyKey),
              ),
            );
          if (existing) {
            if (existing.operation !== "transfer.create") {
              throw new Error(
                "idempotency key was already used for another operation",
              );
            }
            const [transfer] = await tx
              .select()
              .from(schema.transfers)
              .where(
                and(
                  eq(schema.transfers.bookId, bookId),
                  eq(schema.transfers.id, Number(existing.resourceId)),
                ),
              );
            if (!transfer)
              throw new Error("idempotency record references no transfer");
            return transferFromRow(transfer);
          }
        }
        const correlationId = audit.correlationId;
        const [payment] = await tx
          .insert(schema.payments)
          .values({
            bookId,
            accountId: Number(input.sourceAccountId),
            amountMinor: input.amountMinor,
            currency: input.currency,
          })
          .returning();
        const [receipt] = await tx
          .insert(schema.receipts)
          .values({
            bookId,
            accountId: Number(input.destinationAccountId),
            amountMinor: input.amountMinor,
            currency: input.currency,
          })
          .returning();
        const [transfer] = await tx
          .insert(schema.transfers)
          .values({
            bookId,
            sourcePaymentId: payment.id,
            destinationReceiptId: receipt.id,
            correlationId,
            amountMinor: input.amountMinor,
            currency: input.currency,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(transfer.id)));
        if (input.idempotencyKey) {
          await tx.insert(schema.idempotencyRecords).values({
            bookId,
            key: input.idempotencyKey,
            operation: "transfer.create",
            resourceType: "transfer",
            resourceId: String(transfer.id),
          });
        }
        return transferFromRow(transfer);
      });
    },

    async listTransfers(bookId: string): Promise<Transfer[]> {
      const rows = await db
        .select()
        .from(schema.transfers)
        .where(eq(schema.transfers.bookId, bookNumber(bookId)));
      return rows.map(transferFromRow);
    },

    async getTransferByCorrelation(
      correlationId: string,
    ): Promise<Transfer | null> {
      const [row] = await db
        .select()
        .from(schema.transfers)
        .where(eq(schema.transfers.correlationId, correlationId));
      return row ? transferFromRow(row) : null;
    },

    async upsertImportedMovement(input: {
      bookId: string;
      provider: string;
      providerAccountId: string;
      externalReference: string;
      kind: "DEBIT" | "CREDIT";
      amountMinor: bigint;
      currency: string;
      occurredAt: Date;
    }) {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        const [existing] = await tx
          .select()
          .from(schema.importedMovements)
          .where(
            and(
              eq(schema.importedMovements.bookId, bookId),
              eq(schema.importedMovements.provider, input.provider),
              eq(
                schema.importedMovements.externalReference,
                input.externalReference,
              ),
            ),
          );
        if (existing) {
          const [updated] = await tx
            .update(schema.importedMovements)
            .set({ status: "UNCHANGED" })
            .where(eq(schema.importedMovements.id, existing.id))
            .returning();
          return {
            movement: importedMovementFromRow(updated),
            unchanged: true,
          };
        }
        const [row] = await tx
          .insert(schema.importedMovements)
          .values({
            bookId,
            provider: input.provider,
            providerAccountId: input.providerAccountId,
            externalReference: input.externalReference,
            kind: input.kind,
            amountMinor: input.amountMinor,
            currency: input.currency,
            occurredAt: input.occurredAt,
            status: "REVIEW",
          })
          .returning();
        return { movement: importedMovementFromRow(row), unchanged: false };
      });
    },

    async listImportedMovements(bookId: string) {
      const rows = await db
        .select()
        .from(schema.importedMovements)
        .where(eq(schema.importedMovements.bookId, bookNumber(bookId)));
      return rows.map(importedMovementFromRow);
    },

    async markImportedMovementConverted(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.importedMovements)
          .set({ status: "CONVERTED" })
          .where(
            and(
              eq(schema.importedMovements.bookId, bookNumber(bookId)),
              eq(schema.importedMovements.id, Number(id)),
            ),
          )
          .returning();
        if (!row) throw new Error("imported movement was not found");
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return importedMovementFromRow(row);
      });
    },

    async createJob(input: {
      bookId: string;
      type: string;
      payload: Record<string, unknown>;
      nextRunAt: Date;
      maxAttempts?: number;
    }) {
      const [row] = await db
        .insert(schema.jobs)
        .values({
          bookId: bookNumber(input.bookId),
          type: input.type,
          payload: input.payload,
          nextRunAt: input.nextRunAt,
          maxAttempts: input.maxAttempts ?? 3,
        })
        .returning();
      return jobFromRow(row);
    },

    async claimDueJob(workerId: string, now: Date) {
      const nowIso = now.toISOString();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.jobs)
          .where(
            and(
              eq(schema.jobs.status, "PENDING"),
              sql`${schema.jobs.nextRunAt} <= ${nowIso}::timestamptz`,
              sql`(${schema.jobs.leasedUntil} is null or ${schema.jobs.leasedUntil} < ${nowIso}::timestamptz)`,
            ),
          )
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return null;
        const [claimed] = await tx
          .update(schema.jobs)
          .set({
            status: "RUNNING",
            leasedBy: workerId,
            leasedUntil: new Date(now.getTime() + 60_000),
            attempts: row.attempts + 1,
          })
          .where(eq(schema.jobs.id, row.id))
          .returning();
        return jobFromRow(claimed);
      });
    },

    async completeJob(id: string, bookId: string) {
      const [row] = await db
        .update(schema.jobs)
        .set({ status: "SUCCEEDED", leasedBy: null, leasedUntil: null })
        .where(
          and(
            eq(schema.jobs.id, Number(id)),
            eq(schema.jobs.bookId, bookNumber(bookId)),
          ),
        )
        .returning();
      return row ? jobFromRow(row) : null;
    },

    async failJob(
      id: string,
      bookId: string,
      error: string,
      nextRunAt: Date,
      maxAttempts: number,
    ) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.jobs)
          .where(
            and(
              eq(schema.jobs.id, Number(id)),
              eq(schema.jobs.bookId, bookNumber(bookId)),
            ),
          );
        if (!row) return null;
        const failed = row.attempts >= maxAttempts;
        const [updated] = await tx
          .update(schema.jobs)
          .set({
            status: failed ? "FAILED" : "PENDING",
            leasedBy: null,
            leasedUntil: null,
            lastError: error,
            nextRunAt: failed ? row.nextRunAt : nextRunAt,
          })
          .where(eq(schema.jobs.id, row.id))
          .returning();
        return jobFromRow(updated);
      });
    },

    async releaseJobLease(id: string, bookId: string) {
      const [row] = await db
        .update(schema.jobs)
        .set({ status: "PENDING", leasedBy: null, leasedUntil: null })
        .where(
          and(
            eq(schema.jobs.id, Number(id)),
            eq(schema.jobs.bookId, bookNumber(bookId)),
          ),
        )
        .returning();
      return row ? jobFromRow(row) : null;
    },

    async listJobs(bookId: string) {
      const rows = await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.bookId, bookNumber(bookId)));
      return rows.map(jobFromRow);
    },

    auth: createAuthStore(db),
  };
  return repository;
}

export function createAuthStore(db: Database) {
  return {
    async createAgentCredential(credential: {
      id: string;
      bookId: string;
      principal: string;
      delegatedOperator: string;
      secretHash: string;
      revokedAt: Date | null;
    }) {
      const [row] = await db
        .insert(schema.agentCredentials)
        .values({
          id: credential.id,
          bookId: bookNumber(credential.bookId),
          principal: credential.principal,
          delegatedOperator: credential.delegatedOperator,
          secretHash: credential.secretHash,
          revokedAt: credential.revokedAt,
        })
        .returning();
      return {
        ...credential,
        bookId: String(row.bookId),
        createdAt: row.createdAt,
      };
    },

    async getAgentCredential(id: string) {
      const [row] = await db
        .select()
        .from(schema.agentCredentials)
        .where(eq(schema.agentCredentials.id, id));
      if (!row) return null;
      return {
        id: row.id,
        bookId: String(row.bookId),
        principal: row.principal,
        delegatedOperator: row.delegatedOperator,
        secretHash: row.secretHash,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      };
    },

    async revokeAgentCredential(id: string, bookId: string): Promise<void> {
      await db
        .update(schema.agentCredentials)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.agentCredentials.id, id),
            eq(schema.agentCredentials.bookId, bookNumber(bookId)),
          ),
        );
    },

    async getMembership(userId: string, bookId: string): Promise<Role | null> {
      const [row] = await db
        .select({ role: schema.bookMembers.role })
        .from(schema.bookMembers)
        .where(
          and(
            eq(schema.bookMembers.userId, userId),
            eq(schema.bookMembers.bookId, bookNumber(bookId)),
          ),
        );
      return row ? roleFromValue(row.role) : null;
    },

    async createSession(session: {
      id: string;
      userId: string;
      secretHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    }) {
      const [row] = await db
        .insert(schema.sessions)
        .values(session)
        .returning();
      return { ...session, createdAt: row.createdAt };
    },

    async getSession(id: string) {
      const [row] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id));
      return row ?? null;
    },

    async revokeSession(id: string): Promise<void> {
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.id, id));
    },
  };
}

export * from "./schema";
export { pingDatabase } from "./ping";
export { runMigrate } from "./migrate";
