import {
  type Account,
  type AccountDescriptor,
  type AccountMovement,
  type AccountReferenceMonth,
  type AuditEvent,
  type Book,
  type BookInsights,
  type CardDescriptor,
  type CardMovement,
  type Category,
  type Expense,
  type Institution,
  type MovementStatus,
  type Party,
  type Payment,
  type PaymentMethod,
  type PendingAccountDescriptor,
  type PendingCardDescriptor,
  type Receipt,
  type Revenue,
  type RevenueSettlement,
  type Role,
  type Transfer,
  UnauthorizedError,
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

function institutionFromRow(
  row: typeof schema.institutions.$inferSelect,
): Institution {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    key: row.key,
    name: row.name,
    createdAt: row.createdAt,
  };
}

function accountFromRow(row: typeof schema.accounts.$inferSelect): Account {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    key: row.key,
    institutionId:
      row.institutionId === null ? null : String(row.institutionId),
    number: row.number,
    name: row.name,
    type: row.type,
    createdAt: row.createdAt,
  };
}

function partyFromRow(row: typeof schema.parties.$inferSelect): Party {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    key: row.key,
    name: row.name,
    type: row.type,
    createdAt: row.createdAt,
  };
}

function cardDescriptorFromRow(
  row: typeof schema.cardDescriptors.$inferSelect,
): CardDescriptor {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    key: row.key,
    partyId: row.partyId === null ? null : String(row.partyId),
    categoryId: row.categoryId === null ? null : String(row.categoryId),
    name: row.name,
    createdAt: row.createdAt,
  };
}

function accountDescriptorFromRow(
  row: typeof schema.accountDescriptors.$inferSelect,
): AccountDescriptor {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    key: row.key,
    partyId: row.partyId === null ? null : String(row.partyId),
    categoryId: row.categoryId === null ? null : String(row.categoryId),
    method: (row.method as PaymentMethod | null) ?? null,
    counterAccountId:
      row.counterAccountId === null ? null : String(row.counterAccountId),
    name: row.name,
    createdAt: row.createdAt,
  };
}

type Evidence = {
  movements: number;
  total: bigint;
  dates: Date[];
  hints: Map<string, number>;
};

/**
 * Tally the movements behind each descriptor: how many, how much, when, and
 * what the institution called them. Both statement kinds answer the same
 * question from different columns, so they hand this the four values it needs
 * rather than each keeping its own copy of the loop.
 */
function gatherEvidence(
  rows: { key: string; amount: bigint; date: Date; hint: string | null }[],
): Map<string, Evidence> {
  const evidence = new Map<string, Evidence>();
  for (const row of rows) {
    const entry = evidence.get(row.key) ?? {
      movements: 0,
      total: 0n,
      dates: [],
      hints: new Map<string, number>(),
    };
    entry.movements += 1;
    entry.total += row.amount;
    entry.dates.push(row.date);
    if (row.hint?.trim()) {
      entry.hints.set(row.hint, (entry.hints.get(row.hint) ?? 0) + 1);
    }
    evidence.set(row.key, entry);
  }
  return evidence;
}

/** The evidence as the queue reports it: a count, a total, a span, hints. */
function summarise(seen: Evidence | undefined) {
  const dates = (seen?.dates ?? [])
    .map((date) => date.getTime())
    .sort((left, right) => left - right);
  const first = dates[0];
  const last = dates.at(-1);
  return {
    movements: seen?.movements ?? 0,
    total: seen?.total ?? 0n,
    firstSeen: first === undefined ? null : new Date(first),
    lastSeen: last === undefined ? null : new Date(last),
    sourceCategories: [...(seen?.hints ?? new Map<string, number>())]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count),
  };
}

function cardMovementFromRow(
  row: typeof schema.cardMovements.$inferSelect,
): CardMovement {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    institutionId: String(row.institutionId),
    accountId: String(row.accountId),
    source: row.source,
    key: row.key,
    occurrence: row.occurrence,
    purchaseDate: row.purchaseDate,
    cardholder: row.cardholder,
    cardNumber: row.cardNumber,
    category: row.category,
    title: row.title,
    description: row.description,
    descriptorKey: row.descriptorKey,
    installmentNumber: row.installmentNumber,
    installmentCount: row.installmentCount,
    amount: row.amount,
    currency: row.currency,
    status: row.status as MovementStatus,
    expenseId: row.expenseId === null ? null : String(row.expenseId),
    revenueId: row.revenueId === null ? null : String(row.revenueId),
    transferId: row.transferId === null ? null : String(row.transferId),
    importedAt: row.importedAt,
  };
}

function accountMovementFromRow(
  row: typeof schema.accountMovements.$inferSelect,
): AccountMovement {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    institutionId: String(row.institutionId),
    accountId: String(row.accountId),
    source: row.source,
    key: row.key,
    occurrence: row.occurrence,
    purchaseDate: row.purchaseDate,
    branch: row.branch,
    accountNumber: row.accountNumber,
    category: row.category,
    title: row.title,
    description: row.description,
    descriptorKey: row.descriptorKey,
    amount: row.amount,
    currency: row.currency,
    status: row.status as MovementStatus,
    expenseId: row.expenseId === null ? null : String(row.expenseId),
    revenueId: row.revenueId === null ? null : String(row.revenueId),
    transferId: row.transferId === null ? null : String(row.transferId),
    importedAt: row.importedAt,
  };
}

function accountReferenceMonthFromRow(
  row: typeof schema.accountReferenceMonths.$inferSelect,
): AccountReferenceMonth {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    referenceMonth: row.referenceMonth,
    startDate: row.startDate,
    endDate: row.endDate,
    createdAt: row.createdAt,
  };
}

function categoryFromRow(row: typeof schema.categories.$inferSelect): Category {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    kind: row.kind,
    parentId: row.parentId === null ? null : String(row.parentId),
    name: row.name,
    createdAt: row.createdAt,
  };
}

function expenseFromRow(row: typeof schema.expenses.$inferSelect): Expense {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    key: row.key,
    referenceMonth: row.referenceMonth,
    partyId: String(row.partyId),
    categoryId: String(row.categoryId),
    name: row.name,
    amount: row.amount,
    currency: row.currency,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function paymentFromRow(row: typeof schema.payments.$inferSelect) {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    key: row.key,
    referenceMonth: row.referenceMonth,
    amount: row.amount,
    currency: row.currency,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

function settlementFromRow(row: typeof schema.expenseSettlements.$inferSelect) {
  return {
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
    createdAt: row.createdAt,
  };
}

function revenueFromRow(row: typeof schema.revenues.$inferSelect): Revenue {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    key: row.key,
    referenceMonth: row.referenceMonth,
    partyId: String(row.partyId),
    categoryId: String(row.categoryId),
    name: row.name,
    amount: row.amount,
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
    key: row.key,
    referenceMonth: row.referenceMonth,
    amount: row.amount,
    currency: row.currency,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
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
    amount: row.amount,
    currency: row.currency,
    description: row.description,
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
    key: row.key,
    referenceMonth: row.referenceMonth,
    sourceAccountId: String(row.sourceAccountId),
    destinationAccountId: String(row.destinationAccountId),
    name: row.name,
    amount: row.amount,
    currency: row.currency,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
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

/*
 * Idempotent create, shared by the catalog resources.
 *
 * The advisory lock serialises concurrent callers using the same key, so the
 * loser waits and then finds the winner's record instead of inserting a second
 * one. The MCP tools require an idempotency key on every write, so a create
 * that accepts the key and ignores it is promising a guarantee it does not
 * provide — a retried call after a dropped connection would duplicate the
 * record.
 */
async function withIdempotency<T>(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: { bookId: number; key?: string; operation: string },
  replay: (resourceId: string) => Promise<T | undefined>,
  create: () => Promise<{ id: number; value: T }>,
): Promise<T> {
  if (!input.key) return (await create()).value;

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${input.bookId}:${input.key}`}))`,
  );
  const [existing] = await tx
    .select()
    .from(schema.idempotencyRecords)
    .where(
      and(
        eq(schema.idempotencyRecords.bookId, input.bookId),
        eq(schema.idempotencyRecords.key, input.key),
      ),
    );

  if (existing) {
    if (existing.operation !== input.operation) {
      throw new Error("idempotency key was already used for another operation");
    }
    const replayed = await replay(existing.resourceId);
    if (!replayed) {
      throw new Error("idempotency record references no resource");
    }
    return replayed;
  }

  const created = await create();
  await tx.insert(schema.idempotencyRecords).values({
    bookId: input.bookId,
    key: input.key,
    operation: input.operation,
    resourceType: input.operation.split(".")[0],
    resourceId: String(created.id),
  });
  return created.value;
}

export function createRepositories(db: Database) {
  const repository = {
    /*
     * Better Auth owns the sign-up path (it hashes the password and writes the
     * `account` row). This exists only so fixtures and the bootstrap script can
     * attach a Book membership to an identity without going through a password
     * flow — it never grants anyone the ability to log in.
     */
    async createUser(input: { id: string; email: string; name: string }) {
      const [row] = await db.insert(schema.user).values(input).returning();
      return row;
    },

    /** Resolve an identity the bootstrap may have created on an earlier run. */
    async getUserByEmail(email: string) {
      const [row] = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, email));
      return row ?? null;
    },

    async createBook(name: string): Promise<Book> {
      const [row] = await db.insert(schema.books).values({ name }).returning();
      return bookFromRow(row);
    },

    /*
     * "Ensure this role", not "insert once". Bootstrap now runs against Books
     * that already exist — attaching a read-only consolidator to a live Book is
     * the reason it does — and a plain insert would fail on the primary key.
     * The trade is that a re-run with a different role rewrites the existing
     * one, so the caller decides deliberately what it passes.
     */
    async addBookMember(input: {
      bookId: string;
      userId: string;
      role: Role;
    }): Promise<void> {
      await db
        .insert(schema.bookMembers)
        .values({
          bookId: bookNumber(input.bookId),
          userId: input.userId,
          role: input.role,
        })
        .onConflictDoUpdate({
          target: [schema.bookMembers.bookId, schema.bookMembers.userId],
          set: { role: input.role },
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

    async createInstitution(
      input: Omit<Institution, "id"> & { idempotencyKey?: string },
      audit: AuditEvent,
    ): Promise<Institution> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        return withIdempotency(
          tx,
          {
            bookId,
            key: input.idempotencyKey,
            operation: "institution.create",
          },
          async (resourceId) => {
            const [existing] = await tx
              .select()
              .from(schema.institutions)
              .where(
                and(
                  eq(schema.institutions.bookId, bookId),
                  eq(schema.institutions.id, Number(resourceId)),
                ),
              );
            return existing ? institutionFromRow(existing) : undefined;
          },
          async () => {
            const [row] = await tx
              .insert(schema.institutions)
              .values({
                bookId,
                key: input.key,
                name: input.name,
              })
              .returning();
            await tx
              .insert(schema.auditEvents)
              .values(auditValues(audit, String(row.id)));
            return { id: row.id, value: institutionFromRow(row) };
          },
        );
      });
    },

    async listInstitutions(bookId: string): Promise<Institution[]> {
      const rows = await db
        .select()
        .from(schema.institutions)
        .where(eq(schema.institutions.bookId, bookNumber(bookId)));
      return rows.map(institutionFromRow);
    },

    async updateInstitution(
      input: { bookId: string; id: string; key?: string; name?: string },
      audit: AuditEvent,
    ): Promise<Institution> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.institutions)
          .set({
            ...(input.key === undefined ? {} : { key: input.key }),
            ...(input.name === undefined ? {} : { name: input.name }),
          })
          .where(
            and(
              eq(schema.institutions.bookId, bookNumber(input.bookId)),
              eq(schema.institutions.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return institutionFromRow(row);
      });
    },

    async deleteInstitution(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.institutions)
          .where(
            and(
              eq(schema.institutions.bookId, bookNumber(bookId)),
              eq(schema.institutions.id, Number(id)),
            ),
          )
          .returning({ id: schema.institutions.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async createAccount(
      input: Omit<Account, "id"> & { idempotencyKey?: string },
      audit: AuditEvent,
    ): Promise<Account> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        return withIdempotency(
          tx,
          { bookId, key: input.idempotencyKey, operation: "account.create" },
          async (resourceId) => {
            const [existing] = await tx
              .select()
              .from(schema.accounts)
              .where(
                and(
                  eq(schema.accounts.bookId, bookId),
                  eq(schema.accounts.id, Number(resourceId)),
                ),
              );
            return existing ? accountFromRow(existing) : undefined;
          },
          async () => {
            const [row] = await tx
              .insert(schema.accounts)
              .values({
                bookId,
                key: input.key,
                institutionId:
                  input.institutionId == null
                    ? null
                    : Number(input.institutionId),
                number: input.number ?? null,
                name: input.name,
                type: input.type,
              })
              .returning();
            await tx
              .insert(schema.auditEvents)
              .values(auditValues(audit, String(row.id)));
            return { id: row.id, value: accountFromRow(row) };
          },
        );
      });
    },

    async listAccounts(bookId: string): Promise<Account[]> {
      const rows = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.bookId, bookNumber(bookId)));
      return rows.map(accountFromRow);
    },

    async updateAccount(
      input: {
        bookId: string;
        id: string;
        key?: string;
        institutionId?: string | null;
        number?: string | null;
        name?: string;
        type?: string;
      },
      audit: AuditEvent,
    ): Promise<Account> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.accounts)
          .set({
            ...(input.key === undefined ? {} : { key: input.key }),
            ...(input.number === undefined ? {} : { number: input.number }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.type === undefined ? {} : { type: input.type }),
            ...(input.institutionId === undefined
              ? {}
              : {
                  institutionId:
                    input.institutionId === null
                      ? null
                      : Number(input.institutionId),
                }),
          })
          .where(
            and(
              eq(schema.accounts.bookId, bookNumber(input.bookId)),
              eq(schema.accounts.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountFromRow(row);
      });
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

    async createAccountReferenceMonth(
      input: Omit<AccountReferenceMonth, "id" | "createdAt">,
      audit: AuditEvent,
    ): Promise<AccountReferenceMonth> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.accountReferenceMonths)
          .values({
            bookId: bookNumber(input.bookId),
            accountId: Number(input.accountId),
            referenceMonth: input.referenceMonth,
            startDate: input.startDate,
            endDate: input.endDate,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountReferenceMonthFromRow(row);
      });
    },

    async listAccountReferenceMonths(
      bookId: string,
      accountId?: string,
    ): Promise<AccountReferenceMonth[]> {
      const rows = await db
        .select()
        .from(schema.accountReferenceMonths)
        .where(
          accountId === undefined
            ? eq(schema.accountReferenceMonths.bookId, bookNumber(bookId))
            : and(
                eq(schema.accountReferenceMonths.bookId, bookNumber(bookId)),
                eq(schema.accountReferenceMonths.accountId, Number(accountId)),
              ),
        )
        .orderBy(schema.accountReferenceMonths.referenceMonth);
      return rows.map(accountReferenceMonthFromRow);
    },

    async updateAccountReferenceMonth(
      input: {
        bookId: string;
        id: string;
        referenceMonth?: Date;
        startDate?: Date;
        endDate?: Date;
      },
      audit: AuditEvent,
    ): Promise<AccountReferenceMonth> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.accountReferenceMonths)
          .set({
            ...(input.referenceMonth === undefined
              ? {}
              : { referenceMonth: input.referenceMonth }),
            ...(input.startDate === undefined
              ? {}
              : { startDate: input.startDate }),
            ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
          })
          .where(
            and(
              eq(
                schema.accountReferenceMonths.bookId,
                bookNumber(input.bookId),
              ),
              eq(schema.accountReferenceMonths.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountReferenceMonthFromRow(row);
      });
    },

    async deleteAccountReferenceMonth(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.accountReferenceMonths)
          .where(
            and(
              eq(schema.accountReferenceMonths.bookId, bookNumber(bookId)),
              eq(schema.accountReferenceMonths.id, Number(id)),
            ),
          )
          .returning({ id: schema.accountReferenceMonths.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    /**
     * A payment by its derived key, or null.
     *
     * This is what makes one bill per month per card: promotion looks here
     * before creating, and the unique index makes the race lose rather than
     * open a second bill.
     */
    /**
     * An expense by its key, or null.
     *
     * Promotion looks here before creating a card purchase: the same purchase
     * appears on every invoice it is billed on, and the second sighting has to
     * find the first one's expense instead of opening a second debt.
     */
    async getExpenseByKey(bookId: string, key: string) {
      const [row] = await db
        .select()
        .from(schema.expenses)
        .where(
          and(
            eq(schema.expenses.bookId, bookNumber(bookId)),
            eq(schema.expenses.key, key),
          ),
        );
      return row ? expenseFromRow(row) : null;
    },

    /**
     * A transfer by its event key, or null.
     *
     * Promotion looks here before creating: the same transfer appears on both
     * statements, and the second sighting has to find the first one's record
     * instead of writing the movement of money twice.
     */
    async getTransferByKey(
      bookId: string,
      key: string,
    ): Promise<Transfer | null> {
      const [row] = await db
        .select()
        .from(schema.transfers)
        .where(
          and(
            eq(schema.transfers.bookId, bookNumber(bookId)),
            eq(schema.transfers.key, key),
          ),
        );
      return row ? transferFromRow(row) : null;
    },

    /** A receipt by its derived key, or null — one per movement, see `movements.ts`. */
    async getReceiptByKey(
      bookId: string,
      key: string,
    ): Promise<Receipt | null> {
      const [row] = await db
        .select()
        .from(schema.receipts)
        .where(
          and(
            eq(schema.receipts.bookId, bookNumber(bookId)),
            eq(schema.receipts.key, key),
          ),
        );
      return row ? receiptFromRow(row) : null;
    },

    async getPaymentByKey(
      bookId: string,
      key: string,
    ): Promise<Payment | null> {
      const [row] = await db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.bookId, bookNumber(bookId)),
            eq(schema.payments.key, key),
          ),
        );
      return row ? paymentFromRow(row) : null;
    },

    async createParty(
      input: Omit<Party, "id"> & { idempotencyKey?: string },
      audit: AuditEvent,
    ): Promise<Party> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        return withIdempotency(
          tx,
          { bookId, key: input.idempotencyKey, operation: "party.create" },
          async (resourceId) => {
            const [existing] = await tx
              .select()
              .from(schema.parties)
              .where(
                and(
                  eq(schema.parties.bookId, bookId),
                  eq(schema.parties.id, Number(resourceId)),
                ),
              );
            return existing ? partyFromRow(existing) : undefined;
          },
          async () => {
            const [row] = await tx
              .insert(schema.parties)
              .values({
                bookId,
                key: input.key,
                name: input.name,
                type: input.type,
              })
              .returning();
            await tx
              .insert(schema.auditEvents)
              .values(auditValues(audit, String(row.id)));
            return { id: row.id, value: partyFromRow(row) };
          },
        );
      });
    },

    async listParties(bookId: string): Promise<Party[]> {
      const rows = await db
        .select()
        .from(schema.parties)
        .where(eq(schema.parties.bookId, bookNumber(bookId)));
      return rows.map(partyFromRow);
    },

    async updateParty(
      input: {
        bookId: string;
        id: string;
        key?: string;
        name?: string;
        type?: string;
      },
      audit: AuditEvent,
    ): Promise<Party> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.parties)
          .set({
            ...(input.key === undefined ? {} : { key: input.key }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.type === undefined ? {} : { type: input.type }),
          })
          .where(
            and(
              eq(schema.parties.bookId, bookNumber(input.bookId)),
              eq(schema.parties.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return partyFromRow(row);
      });
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

    async createCardDescriptor(
      input: Omit<CardDescriptor, "id" | "createdAt">,
      audit: AuditEvent,
    ): Promise<CardDescriptor> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.cardDescriptors)
          .values({
            bookId: bookNumber(input.bookId),
            accountId: Number(input.accountId),
            key: input.key,
            partyId: input.partyId == null ? null : Number(input.partyId),
            categoryId:
              input.categoryId == null ? null : Number(input.categoryId),
            name: input.name ?? null,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return cardDescriptorFromRow(row);
      });
    },

    async createAccountDescriptor(
      input: Omit<AccountDescriptor, "id" | "createdAt">,
      audit: AuditEvent,
    ): Promise<AccountDescriptor> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.accountDescriptors)
          .values({
            bookId: bookNumber(input.bookId),
            accountId: Number(input.accountId),
            key: input.key,
            partyId: input.partyId == null ? null : Number(input.partyId),
            categoryId:
              input.categoryId == null ? null : Number(input.categoryId),
            method: input.method ?? null,
            counterAccountId:
              input.counterAccountId == null
                ? null
                : Number(input.counterAccountId),
            name: input.name ?? null,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountDescriptorFromRow(row);
      });
    },

    /**
     * Record every descriptor the import saw, and no destination beyond what
     * the line's own text implies.
     *
     * Called before the movements, which carry a foreign key to it. `ON
     * CONFLICT DO NOTHING` keeps a descriptor someone already mapped: a
     * re-import must never reset a party, a category, or a corrected method
     * back to what the file suggested.
     *
     * The card side takes keys only — an invoice line has no method to infer,
     * because every line on a credit-card invoice was paid by that card.
     */
    async ensureCardDescriptors(
      bookId: string,
      accountId: string,
      keys: string[],
    ): Promise<CardDescriptor[]> {
      if (keys.length === 0) return [];
      const inserted = await db
        .insert(schema.cardDescriptors)
        .values(
          keys.map((key) => ({
            bookId: bookNumber(bookId),
            accountId: Number(accountId),
            key,
          })),
        )
        .onConflictDoNothing()
        .returning();
      return inserted.map(cardDescriptorFromRow);
    },

    /** See `ensureCardDescriptors`. This side carries the inferred method. */
    async ensureAccountDescriptors(
      bookId: string,
      accountId: string,
      entries: { key: string; method: PaymentMethod | null }[],
    ): Promise<AccountDescriptor[]> {
      if (entries.length === 0) return [];
      const inserted = await db
        .insert(schema.accountDescriptors)
        .values(
          entries.map((entry) => ({
            bookId: bookNumber(bookId),
            accountId: Number(accountId),
            key: entry.key,
            method: entry.method,
          })),
        )
        .onConflictDoNothing()
        .returning();
      return inserted.map(accountDescriptorFromRow);
    },

    /**
     * The three figures the summary is built on, in one round trip.
     *
     * `cash` deliberately excludes card statements. An invoice line carries the
     * date the purchase was made, not the date money moved — an instalment
     * bought in April sits on a September bill — so plotting invoices on a
     * daily axis would show spending in months when nothing left the bank.
     * A statement of account is a cash timeline; an invoice is a document with
     * one due date.
     */
    async bookInsights(bookId: string): Promise<BookInsights> {
      const book = bookNumber(bookId);

      const [staged, booked, aliases, days, groups] = await Promise.all([
        db.execute(sql`
          select
            (select count(*) from card_movements where book_id = ${book})
            + (select count(*) from account_movements where book_id = ${book}) as staged,
            (select count(*) from card_movements
              where book_id = ${book} and status = 'POSTED')
            + (select count(*) from account_movements
              where book_id = ${book} and status = 'POSTED') as posted
        `),
        db.execute(sql`
          select
            (select count(*) from expenses where book_id = ${book}) as expenses,
            (select count(*) from revenues where book_id = ${book}) as revenues,
            (select count(*) from transfers where book_id = ${book}) as transfers
        `),
        /*
         * Both descriptor tables, each with its own definition of pending: the
         * card side waits on a party and a category, the account side also on a
         * method, and an account transfer waits on the other account instead of
         * on a party it will never have.
         */
        db.execute(sql`
          select 'card' as side, count(*) as total,
                 count(*) filter (
                   where party_id is null or category_id is null
                 ) as pending
            from card_descriptors where book_id = ${book}
          union all
          select 'account' as side, count(*) as total,
                 count(*) filter (
                   where case
                     when counter_account_id is not null then method is null
                     else party_id is null or category_id is null or method is null
                   end
                 ) as pending
            from account_descriptors where book_id = ${book}
        `),
        db.execute(sql`
          select source,
                 purchase_date as date,
                 sum(case when amount > 0 then amount else 0 end) as inflow,
                 sum(case when amount < 0 then -amount else 0 end) as outflow
            from account_movements
           where book_id = ${book}
           group by source, purchase_date
           order by source, purchase_date
        `),
        db.execute(sql`
          select g.name as group_name, c.name as category, c.kind,
                 sum(r.amount) as total, count(*) as count
            from (
              select category_id, amount from expenses where book_id = ${book}
              union all
              select category_id, amount from revenues where book_id = ${book}
            ) r
            join categories c on c.book_id = ${book} and c.id = r.category_id
            left join categories g on g.book_id = ${book} and g.id = c.parent_id
           group by g.name, c.name, c.kind
           order by sum(r.amount) desc
        `),
      ]);

      const first = <T>(rows: unknown): T => (rows as T[])[0] as T;
      const counts = first<{ staged: string; posted: string }>(staged);
      const ledger = first<{
        expenses: string;
        revenues: string;
        transfers: string;
      }>(booked);
      const sides = aliases as unknown as {
        side: "card" | "account";
        total: string;
        pending: string;
      }[];
      const side = (which: "card" | "account") => {
        const row = sides.find((entry) => entry.side === which);
        return {
          total: Number(row?.total ?? 0),
          pending: Number(row?.pending ?? 0),
        };
      };
      const card = side("card");
      const account = side("account");

      const bySource = new Map<string, BookInsights["cash"][number]>();
      /*
       * A raw query carries no column mapping, so a `date` column arrives as
       * "2026-08-10" rather than a Date. Parsed as UTC midnight here, at the
       * boundary, so nothing downstream has to know where the row came from.
       */
      for (const row of days as unknown as {
        source: string;
        date: string;
        inflow: string;
        outflow: string;
      }[]) {
        const entry = bySource.get(row.source) ?? {
          source: row.source,
          days: [],
        };
        entry.days.push({
          date: new Date(`${row.date}T00:00:00.000Z`),
          inflow: BigInt(row.inflow),
          outflow: BigInt(row.outflow),
        });
        bySource.set(row.source, entry);
      }

      return {
        gap: {
          stagedMovements: Number(counts.staged),
          postedMovements: Number(counts.posted),
          ledgerRecords:
            Number(ledger.expenses) +
            Number(ledger.revenues) +
            Number(ledger.transfers),
          descriptors: card.total + account.total,
          descriptorsPending: card.pending + account.pending,
          cardDescriptors: card.total,
          cardDescriptorsPending: card.pending,
          accountDescriptors: account.total,
          accountDescriptorsPending: account.pending,
        },
        cash: [...bySource.values()],
        byGroup: (
          groups as unknown as {
            group_name: string | null;
            category: string;
            kind: "EXPENSE" | "REVENUE";
            total: string;
            count: string;
          }[]
        ).map((row) => ({
          group: row.group_name,
          category: row.category,
          kind: row.kind,
          total: BigInt(row.total),
          count: Number(row.count),
        })),
      };
    },

    /**
     * Descriptors still missing a destination, and the evidence for deciding:
     * how many movements point at each, what they add up to, when they ran, and
     * how the institution itself classified them.
     *
     * Counts and totals come from the movements pointing at each descriptor,
     * which is what `descriptor_key` exists for. `sourceCategories` is the
     * *institution's* own classification, carried verbatim and offered as a
     * hint — never applied, because the bank's taxonomy is not this Book's
     * chart of accounts and it is demonstrably wrong sometimes.
     */
    async listPendingCardDescriptors(
      bookId: string,
    ): Promise<PendingCardDescriptor[]> {
      const book = bookNumber(bookId);
      const [descriptors, movements] = await Promise.all([
        db
          .select()
          .from(schema.cardDescriptors)
          .where(eq(schema.cardDescriptors.bookId, book)),
        db
          .select()
          .from(schema.cardMovements)
          .where(eq(schema.cardMovements.bookId, book)),
      ]);

      const evidence = gatherEvidence(
        movements.map((row) => ({
          key: row.descriptorKey,
          amount: row.amount,
          date: row.purchaseDate,
          hint: row.category,
        })),
      );

      return (
        descriptors
          // The card side needs a party and a category; there is no method to
          // wait on and the kind may be read from the sign.
          .filter((row) => row.partyId === null || row.categoryId === null)
          .map((row) => ({
            id: String(row.id),
            bookId: String(row.bookId),
            accountId: String(row.accountId),
            key: row.key,
            partyId: row.partyId === null ? null : String(row.partyId),
            categoryId: row.categoryId === null ? null : String(row.categoryId),
            name: row.name,
            ...summarise(evidence.get(row.key)),
          }))
          // Most movements first: mapping the descriptor that explains forty
          // rows is worth more than the one that explains a single charge.
          .sort((left, right) => right.movements - left.movements)
      );
    },

    /** See `listPendingCardDescriptors`. */
    async listPendingAccountDescriptors(
      bookId: string,
    ): Promise<PendingAccountDescriptor[]> {
      const book = bookNumber(bookId);
      const [descriptors, movements] = await Promise.all([
        db
          .select()
          .from(schema.accountDescriptors)
          .where(eq(schema.accountDescriptors.bookId, book)),
        db
          .select()
          .from(schema.accountMovements)
          .where(eq(schema.accountMovements.bookId, book)),
      ]);

      const evidence = gatherEvidence(
        movements.map((row) => ({
          key: row.descriptorKey,
          amount: row.amount,
          date: row.purchaseDate,
          /*
           * Whichever the statement offers. C6 prints a transaction type in
           * `Título` and no category at all; a bank that prints one would fill
           * `category`, so the stronger hint wins where it exists.
           */
          hint: row.category ?? row.title,
        })),
      );

      return (
        descriptors
          /*
           * Anything still missing what its own destination needs. Naming
           * another account is the declaration that this is a transfer, and a
           * transfer wants neither a party nor a category — it moves your own
           * money — so demanding all of them would leave every transfer in the
           * queue for ever, waiting on fields it will never have.
           */
          .filter((row) =>
            row.counterAccountId !== null
              ? row.method === null
              : row.partyId === null ||
                row.categoryId === null ||
                row.method === null,
          )
          .map((row) => ({
            id: String(row.id),
            bookId: String(row.bookId),
            accountId: String(row.accountId),
            key: row.key,
            partyId: row.partyId === null ? null : String(row.partyId),
            categoryId: row.categoryId === null ? null : String(row.categoryId),
            method: (row.method as PaymentMethod | null) ?? null,
            counterAccountId:
              row.counterAccountId === null
                ? null
                : String(row.counterAccountId),
            name: row.name,
            ...summarise(evidence.get(row.key)),
          }))
          .sort((left, right) => right.movements - left.movements)
      );
    },

    async listCardDescriptors(bookId: string): Promise<CardDescriptor[]> {
      const rows = await db
        .select()
        .from(schema.cardDescriptors)
        .where(eq(schema.cardDescriptors.bookId, bookNumber(bookId)));
      return rows.map(cardDescriptorFromRow);
    },

    async listAccountDescriptors(bookId: string): Promise<AccountDescriptor[]> {
      const rows = await db
        .select()
        .from(schema.accountDescriptors)
        .where(eq(schema.accountDescriptors.bookId, bookNumber(bookId)));
      return rows.map(accountDescriptorFromRow);
    },

    async updateCardDescriptor(
      input: {
        bookId: string;
        id: string;
        partyId?: string | null;
        categoryId?: string | null;
        name?: string | null;
      },
      audit: AuditEvent,
    ): Promise<CardDescriptor> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.cardDescriptors)
          .set({
            ...(input.partyId === undefined
              ? {}
              : {
                  partyId: input.partyId == null ? null : Number(input.partyId),
                }),
            ...(input.categoryId === undefined
              ? {}
              : {
                  categoryId:
                    input.categoryId == null ? null : Number(input.categoryId),
                }),
            ...(input.name === undefined ? {} : { name: input.name }),
          })
          .where(
            and(
              eq(schema.cardDescriptors.bookId, bookNumber(input.bookId)),
              eq(schema.cardDescriptors.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        /*
         * Every expense this descriptor has already promoted was named at
         * that moment, from the name the descriptor held then — there is no
         * later edit path for an expense itself, so nothing here can have
         * since diverged. A renamed descriptor is a correction to what every
         * one of them should have been called, not just the next one; a
         * purchase from March keeping a name the operator has since called
         * wrong would be exactly the gap the earlier bulk fix had to patch
         * by hand.
         */
        if (input.name !== undefined) {
          await tx.execute(sql`
            update expenses
               set name = ${row.name}
             where book_id = ${bookNumber(input.bookId)}
               and id in (
                 select distinct expense_id from card_movements
                  where book_id = ${bookNumber(input.bookId)}
                    and account_id = ${row.accountId}
                    and descriptor_key = ${row.key}
                    and expense_id is not null
               )
          `);
        }
        return cardDescriptorFromRow(row);
      });
    },

    async updateAccountDescriptor(
      input: {
        bookId: string;
        id: string;
        partyId?: string | null;
        categoryId?: string | null;
        method?: PaymentMethod | null;
        counterAccountId?: string | null;
        name?: string | null;
      },
      audit: AuditEvent,
    ): Promise<AccountDescriptor> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.accountDescriptors)
          .set({
            ...(input.method === undefined ? {} : { method: input.method }),
            ...(input.counterAccountId === undefined
              ? {}
              : {
                  counterAccountId:
                    input.counterAccountId == null
                      ? null
                      : Number(input.counterAccountId),
                }),
            ...(input.partyId === undefined
              ? {}
              : {
                  partyId: input.partyId == null ? null : Number(input.partyId),
                }),
            ...(input.categoryId === undefined
              ? {}
              : {
                  categoryId:
                    input.categoryId == null ? null : Number(input.categoryId),
                }),
            ...(input.name === undefined ? {} : { name: input.name }),
          })
          .where(
            and(
              eq(schema.accountDescriptors.bookId, bookNumber(input.bookId)),
              eq(schema.accountDescriptors.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        /*
         * See `updateCardDescriptor` for why this propagates rather than
         * only governing the next promotion. This side promotes to one of
         * three tables — an expense or a revenue depending on the sign, a
         * transfer when `counterAccountId` is the descriptor's own
         * declaration — so all three are covered here. A descriptor only
         * ever produces one of the three, so two of these three updates are
         * always no-ops; which one is live depends on what this descriptor
         * turned out to be.
         */
        if (input.name !== undefined) {
          await tx.execute(sql`
            update expenses
               set name = ${row.name}
             where book_id = ${bookNumber(input.bookId)}
               and id in (
                 select distinct expense_id from account_movements
                  where book_id = ${bookNumber(input.bookId)}
                    and account_id = ${row.accountId}
                    and descriptor_key = ${row.key}
                    and expense_id is not null
               )
          `);
          await tx.execute(sql`
            update revenues
               set name = ${row.name}
             where book_id = ${bookNumber(input.bookId)}
               and id in (
                 select distinct revenue_id from account_movements
                  where book_id = ${bookNumber(input.bookId)}
                    and account_id = ${row.accountId}
                    and descriptor_key = ${row.key}
                    and revenue_id is not null
               )
          `);
          await tx.execute(sql`
            update transfers
               set name = ${row.name}
             where book_id = ${bookNumber(input.bookId)}
               and id in (
                 select distinct transfer_id from account_movements
                  where book_id = ${bookNumber(input.bookId)}
                    and account_id = ${row.accountId}
                    and descriptor_key = ${row.key}
                    and transfer_id is not null
               )
          `);
        }
        return accountDescriptorFromRow(row);
      });
    },

    async deleteCardDescriptor(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.cardDescriptors)
          .where(
            and(
              eq(schema.cardDescriptors.bookId, bookNumber(bookId)),
              eq(schema.cardDescriptors.id, Number(id)),
            ),
          )
          .returning({ id: schema.cardDescriptors.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async deleteAccountDescriptor(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.accountDescriptors)
          .where(
            and(
              eq(schema.accountDescriptors.bookId, bookNumber(bookId)),
              eq(schema.accountDescriptors.id, Number(id)),
            ),
          )
          .returning({ id: schema.accountDescriptors.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async getCardDescriptorByKey(
      bookId: string,
      key: string,
    ): Promise<CardDescriptor | null> {
      const [row] = await db
        .select()
        .from(schema.cardDescriptors)
        .where(
          and(
            eq(schema.cardDescriptors.bookId, bookNumber(bookId)),
            eq(schema.cardDescriptors.key, key),
          ),
        );
      return row ? cardDescriptorFromRow(row) : null;
    },

    async getAccountDescriptorByKey(
      bookId: string,
      key: string,
    ): Promise<AccountDescriptor | null> {
      const [row] = await db
        .select()
        .from(schema.accountDescriptors)
        .where(
          and(
            eq(schema.accountDescriptors.bookId, bookNumber(bookId)),
            eq(schema.accountDescriptors.key, key),
          ),
        );
      return row ? accountDescriptorFromRow(row) : null;
    },

    async createCategory(
      input: Omit<Category, "id"> & { idempotencyKey?: string },
      audit: AuditEvent,
    ): Promise<Category> {
      return db.transaction(async (tx) => {
        const bookId = bookNumber(input.bookId);
        return withIdempotency(
          tx,
          { bookId, key: input.idempotencyKey, operation: "category.create" },
          async (resourceId) => {
            const [existing] = await tx
              .select()
              .from(schema.categories)
              .where(
                and(
                  eq(schema.categories.bookId, bookId),
                  eq(schema.categories.id, Number(resourceId)),
                ),
              );
            return existing ? categoryFromRow(existing) : undefined;
          },
          async () => {
            const [row] = await tx
              .insert(schema.categories)
              .values({
                bookId,
                kind: input.kind,
                name: input.name,
                parentId:
                  input.parentId == null ? null : Number(input.parentId),
              })
              .returning();
            await tx
              .insert(schema.auditEvents)
              .values(auditValues(audit, String(row.id)));
            return { id: row.id, value: categoryFromRow(row) };
          },
        );
      });
    },

    async listCategories(
      bookId: string,
      kind?: Category["kind"],
    ): Promise<Category[]> {
      const rows = await db
        .select()
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.bookId, bookNumber(bookId)),
            kind === undefined ? undefined : eq(schema.categories.kind, kind),
          ),
        );
      return rows.map(categoryFromRow);
    },

    async updateCategory(
      input: {
        bookId: string;
        id: string;
        name?: string;
        kind?: Category["kind"];
        parentId?: string | null;
      },
      audit: AuditEvent,
    ): Promise<Category> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.categories)
          .set({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.parentId === undefined
              ? {}
              : {
                  parentId:
                    input.parentId == null ? null : Number(input.parentId),
                }),
          })
          .where(
            and(
              eq(schema.categories.bookId, bookNumber(input.bookId)),
              eq(schema.categories.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return categoryFromRow(row);
      });
    },

    async deleteCategory(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.categories)
          .where(
            and(
              eq(schema.categories.bookId, bookNumber(bookId)),
              eq(schema.categories.id, Number(id)),
            ),
          )
          .returning({ id: schema.categories.id });
        if (rows[0])
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
      });
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
            key: input.key,
            referenceMonth: input.referenceMonth,
            partyId: Number(input.partyId),
            categoryId: Number(input.categoryId),
            name: input.name ?? null,
            amount: input.amount,
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
        amount: row.amount,
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
        amount: row.amount,
        currency: row.currency,
      }));
    },

    async createPayment(
      input: {
        bookId: string;
        accountId: string;
        key?: string | null;
        method?: PaymentMethod | null;
        referenceMonth: Date;
        /** Accepted only for compatibility with direct repository callers. */
        amount?: bigint;
        currency: string;
        dueAt?: Date;
        paidAt?: Date;
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
            key: input.key ?? null,
            method: input.method ?? null,
            referenceMonth: input.referenceMonth,
            currency: input.currency,
            dueAt: input.dueAt ?? new Date(),
            paidAt: input.paidAt,
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
        amount: bigint;
        currency: string;
        installmentNumber?: number;
        installmentCount?: number;
        description?: string | null;
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
            amount: input.amount,
            currency: input.currency,
            installmentNumber: input.installmentNumber ?? 1,
            installmentCount: input.installmentCount ?? 1,
            description: input.description ?? null,
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
        key: string;
        referenceMonth: Date;
        partyId: string;
        categoryId: string;
        name?: string | null;
        amount: bigint;
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
            key: input.key,
            referenceMonth: input.referenceMonth,
            partyId: Number(input.partyId),
            categoryId: Number(input.categoryId),
            name: input.name ?? null,
            amount: input.amount,
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

    /**
     * A revenue by its key, or null.
     *
     * Promotion looks here before creating an acquirer-deposit line: several
     * flags of one payer settling on one day are one earning, not several, and
     * the second sighting has to find the first one's revenue instead of
     * opening a second.
     */
    async getRevenueByKey(bookId: string, key: string) {
      const [row] = await db
        .select()
        .from(schema.revenues)
        .where(
          and(
            eq(schema.revenues.bookId, bookNumber(bookId)),
            eq(schema.revenues.key, key),
          ),
        );
      return row ? revenueFromRow(row) : null;
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
        amount: row.amount,
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
        amount: row.amount,
        currency: row.currency,
      }));
    },

    async createReceipt(
      input: {
        bookId: string;
        accountId: string;
        key?: string | null;
        method?: PaymentMethod | null;
        referenceMonth: Date;
        amount: bigint;
        currency: string;
        dueAt?: Date;
        paidAt?: Date;
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
            key: input.key ?? null,
            method: input.method ?? null,
            referenceMonth: input.referenceMonth,
            amount: input.amount,
            currency: input.currency,
            dueAt: input.dueAt ?? new Date(),
            paidAt: input.paidAt,
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
        amount: bigint;
        currency: string;
        description?: string | null;
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
            amount: input.amount,
            currency: input.currency,
            description: input.description ?? null,
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
        key: string;
        referenceMonth: Date;
        sourceAccountId: string;
        destinationAccountId: string;
        name?: string | null;
        amount: bigint;
        currency: string;
        occurredAt?: Date;
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
        const [transfer] = await tx
          .insert(schema.transfers)
          .values({
            bookId,
            key: input.key,
            referenceMonth: input.referenceMonth,
            sourceAccountId: Number(input.sourceAccountId),
            destinationAccountId: Number(input.destinationAccountId),
            name: input.name ?? null,
            amount: input.amount,
            currency: input.currency,
            occurredAt: input.occurredAt,
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

    ...createMovementStore(db),
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
  };
}

/*
 * Statement-movement staging, spread into the repository rather than nested.
 *
 * These methods spent a while inside the auth store, where the only way to
 * reach them was `repositories.auth.insertCardMovements` — a path no caller
 * would guess. Nothing had called them yet, so the mistake was invisible; the
 * import orchestration is what would have found it.
 */
export function createMovementStore(db: Database) {
  return {
    /**
     * Insert staged card rows, skipping any already present.
     *
     * `ON CONFLICT DO NOTHING` against `(book_id, key, occurrence)` is what
     * makes re-importing a statement a no-op rather than a doubling. The
     * returned rows are the ones that were actually new, so a caller can report
     * how much of a file was already known without a second query.
     */
    async insertCardMovements(
      rows: Omit<CardMovement, "id" | "importedAt">[],
    ): Promise<CardMovement[]> {
      if (rows.length === 0) return [];
      const inserted = await db
        .insert(schema.cardMovements)
        .values(
          rows.map((row) => ({
            bookId: bookNumber(row.bookId),
            institutionId: Number(row.institutionId),
            accountId: Number(row.accountId),
            source: row.source,
            key: row.key,
            occurrence: row.occurrence,
            purchaseDate: row.purchaseDate,
            cardholder: row.cardholder ?? null,
            cardNumber: row.cardNumber ?? null,
            category: row.category ?? null,
            title: row.title ?? null,
            description: row.description,
            descriptorKey: row.descriptorKey,
            installmentNumber: row.installmentNumber ?? null,
            installmentCount: row.installmentCount ?? null,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            expenseId: row.expenseId == null ? null : Number(row.expenseId),
            revenueId: row.revenueId == null ? null : Number(row.revenueId),
            transferId: row.transferId == null ? null : Number(row.transferId),
          })),
        )
        .onConflictDoNothing()
        .returning();
      return inserted.map(cardMovementFromRow);
    },

    async insertAccountMovements(
      rows: Omit<AccountMovement, "id" | "importedAt">[],
    ): Promise<AccountMovement[]> {
      if (rows.length === 0) return [];
      const inserted = await db
        .insert(schema.accountMovements)
        .values(
          rows.map((row) => ({
            bookId: bookNumber(row.bookId),
            institutionId: Number(row.institutionId),
            accountId: Number(row.accountId),
            source: row.source,
            key: row.key,
            occurrence: row.occurrence,
            purchaseDate: row.purchaseDate,
            branch: row.branch ?? null,
            accountNumber: row.accountNumber ?? null,
            category: row.category ?? null,
            title: row.title ?? null,
            description: row.description,
            descriptorKey: row.descriptorKey,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            expenseId: row.expenseId == null ? null : Number(row.expenseId),
            revenueId: row.revenueId == null ? null : Number(row.revenueId),
            transferId: row.transferId == null ? null : Number(row.transferId),
          })),
        )
        .onConflictDoNothing()
        .returning();
      return inserted.map(accountMovementFromRow);
    },

    async getCardMovement(
      bookId: string,
      id: string,
    ): Promise<CardMovement | null> {
      const [row] = await db
        .select()
        .from(schema.cardMovements)
        .where(
          and(
            eq(schema.cardMovements.bookId, bookNumber(bookId)),
            eq(schema.cardMovements.id, Number(id)),
          ),
        );
      return row ? cardMovementFromRow(row) : null;
    },

    async getAccountMovement(
      bookId: string,
      id: string,
    ): Promise<AccountMovement | null> {
      const [row] = await db
        .select()
        .from(schema.accountMovements)
        .where(
          and(
            eq(schema.accountMovements.bookId, bookNumber(bookId)),
            eq(schema.accountMovements.id, Number(id)),
          ),
        );
      return row ? accountMovementFromRow(row) : null;
    },

    async listCardMovements(
      bookId: string,
      status?: MovementStatus,
    ): Promise<CardMovement[]> {
      const where = status
        ? and(
            eq(schema.cardMovements.bookId, bookNumber(bookId)),
            eq(schema.cardMovements.status, status),
          )
        : eq(schema.cardMovements.bookId, bookNumber(bookId));
      const rows = await db.select().from(schema.cardMovements).where(where);
      return rows.map(cardMovementFromRow);
    },

    async listAccountMovements(
      bookId: string,
      status?: MovementStatus,
    ): Promise<AccountMovement[]> {
      const where = status
        ? and(
            eq(schema.accountMovements.bookId, bookNumber(bookId)),
            eq(schema.accountMovements.status, status),
          )
        : eq(schema.accountMovements.bookId, bookNumber(bookId));
      const rows = await db.select().from(schema.accountMovements).where(where);
      return rows.map(accountMovementFromRow);
    },

    /**
     * Move a staged row out of review. The database enforces that POSTED and
     * `expense_id` travel together, so a caller cannot mark a row posted while
     * leaving no record of what it became.
     */
    async setCardMovementStatus(
      input: {
        bookId: string;
        id: string;
        status: MovementStatus;
        expenseId?: string | null;
        revenueId?: string | null;
        transferId?: string | null;
      },
      audit: AuditEvent,
    ): Promise<CardMovement> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.cardMovements)
          .set({
            status: input.status,
            expenseId: input.expenseId == null ? null : Number(input.expenseId),
            revenueId: input.revenueId == null ? null : Number(input.revenueId),
            transferId:
              input.transferId == null ? null : Number(input.transferId),
          })
          .where(
            and(
              eq(schema.cardMovements.bookId, bookNumber(input.bookId)),
              eq(schema.cardMovements.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new Error(`card movement not found: ${input.id}`);
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return cardMovementFromRow(row);
      });
    },

    async setAccountMovementStatus(
      input: {
        bookId: string;
        id: string;
        status: MovementStatus;
        expenseId?: string | null;
        revenueId?: string | null;
        transferId?: string | null;
      },
      audit: AuditEvent,
    ): Promise<AccountMovement> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.accountMovements)
          .set({
            status: input.status,
            expenseId: input.expenseId == null ? null : Number(input.expenseId),
            revenueId: input.revenueId == null ? null : Number(input.revenueId),
            transferId:
              input.transferId == null ? null : Number(input.transferId),
          })
          .where(
            and(
              eq(schema.accountMovements.bookId, bookNumber(input.bookId)),
              eq(schema.accountMovements.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new Error(`account movement not found: ${input.id}`);
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountMovementFromRow(row);
      });
    },
  };
}

export * from "./schema";
export { pingDatabase } from "./ping";
export { initializeDatabase } from "./initialize";
