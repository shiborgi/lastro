import {
  type Account,
  type AccountDate,
  type AuditEvent,
  type Book,
  type Category,
  type Expense,
  type Institution,
  type Party,
  type PartyAlias,
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

function partyAliasFromRow(
  row: typeof schema.partyAlias.$inferSelect,
): PartyAlias {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    key: row.key,
    partyId: row.partyId === null ? null : String(row.partyId),
    categoryId: row.categoryId === null ? null : String(row.categoryId),
    createdAt: row.createdAt,
  };
}

function accountDateFromRow(
  row: typeof schema.accountDates.$inferSelect,
): AccountDate {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    accountId: String(row.accountId),
    referenceMonth: row.referenceMonth,
    closeDate: row.closeDate,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
  };
}

function categoryFromRow(row: typeof schema.categories.$inferSelect): Category {
  return {
    id: String(row.id),
    bookId: String(row.bookId),
    kind: row.kind,
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
    correlationId: row.correlationId,
    amount: row.amount,
    currency: row.currency,
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

    async createAccountDate(
      input: Omit<AccountDate, "id" | "createdAt">,
      audit: AuditEvent,
    ): Promise<AccountDate> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.accountDates)
          .values({
            bookId: bookNumber(input.bookId),
            accountId: Number(input.accountId),
            referenceMonth: input.referenceMonth,
            closeDate: input.closeDate,
            dueDate: input.dueDate,
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return accountDateFromRow(row);
      });
    },

    async listAccountDates(bookId: string): Promise<AccountDate[]> {
      const rows = await db
        .select()
        .from(schema.accountDates)
        .where(eq(schema.accountDates.bookId, bookNumber(bookId)));
      return rows.map(accountDateFromRow);
    },

    async getAccountDate(
      bookId: string,
      accountId: string,
      referenceMonth: Date,
    ): Promise<AccountDate | null> {
      const [row] = await db
        .select()
        .from(schema.accountDates)
        .where(
          and(
            eq(schema.accountDates.bookId, bookNumber(bookId)),
            eq(schema.accountDates.accountId, Number(accountId)),
            eq(schema.accountDates.referenceMonth, referenceMonth),
          ),
        );
      return row ? accountDateFromRow(row) : null;
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

    async createPartyAlias(
      input: Omit<PartyAlias, "id" | "createdAt">,
      audit: AuditEvent,
    ): Promise<PartyAlias> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.partyAlias)
          .values({
            bookId: bookNumber(input.bookId),
            accountId: Number(input.accountId),
            key: input.key,
            partyId: input.partyId == null ? null : Number(input.partyId),
            categoryId:
              input.categoryId == null ? null : Number(input.categoryId),
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return partyAliasFromRow(row);
      });
    },

    async listPartyAliases(bookId: string): Promise<PartyAlias[]> {
      const rows = await db
        .select()
        .from(schema.partyAlias)
        .where(eq(schema.partyAlias.bookId, bookNumber(bookId)));
      return rows.map(partyAliasFromRow);
    },

    async updatePartyAlias(
      input: {
        bookId: string;
        id: string;
        key?: string;
        accountId?: string;
        partyId?: string | null;
        categoryId?: string | null;
      },
      audit: AuditEvent,
    ): Promise<PartyAlias> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.partyAlias)
          .set({
            ...(input.key === undefined ? {} : { key: input.key }),
            ...(input.accountId === undefined
              ? {}
              : { accountId: Number(input.accountId) }),
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
          })
          .where(
            and(
              eq(schema.partyAlias.bookId, bookNumber(input.bookId)),
              eq(schema.partyAlias.id, Number(input.id)),
            ),
          )
          .returning();
        if (!row) throw new UnauthorizedError();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return partyAliasFromRow(row);
      });
    },

    async deletePartyAlias(
      bookId: string,
      id: string,
      audit: AuditEvent,
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const rows = await tx
          .delete(schema.partyAlias)
          .where(
            and(
              eq(schema.partyAlias.bookId, bookNumber(bookId)),
              eq(schema.partyAlias.id, Number(id)),
            ),
          )
          .returning({ id: schema.partyAlias.id });
        if (rows[0]) {
          await tx
            .insert(schema.auditEvents)
            .values(auditValues(audit, String(rows[0].id)));
        }
      });
    },

    async getPartyAliasByKey(
      bookId: string,
      key: string,
    ): Promise<PartyAlias | null> {
      const [row] = await db
        .select()
        .from(schema.partyAlias)
        .where(
          and(
            eq(schema.partyAlias.bookId, bookNumber(bookId)),
            eq(schema.partyAlias.key, key),
          ),
        );
      return row ? partyAliasFromRow(row) : null;
    },

    async resolvePartyAlias(
      input: {
        bookId: string;
        id: string;
        partyId: string;
        categoryId?: string | null;
      },
      audit: AuditEvent,
    ): Promise<PartyAlias> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.partyAlias)
          .set({
            partyId: Number(input.partyId),
            ...(input.categoryId === undefined
              ? {}
              : {
                  categoryId:
                    input.categoryId == null ? null : Number(input.categoryId),
                }),
          })
          .where(
            and(
              eq(schema.partyAlias.bookId, bookNumber(input.bookId)),
              eq(schema.partyAlias.id, Number(input.id)),
              sql`${schema.partyAlias.partyId} is null`,
            ),
          )
          .returning();
        if (!row) throw new Error("unresolved party alias was not found");
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
        return partyAliasFromRow(row);
      });
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
      },
      audit: AuditEvent,
    ): Promise<Category> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.categories)
          .set({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.kind === undefined ? {} : { kind: input.kind }),
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
        amount: bigint;
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
        const [transfer] = await tx
          .insert(schema.transfers)
          .values({
            bookId,
            key: input.key,
            referenceMonth: input.referenceMonth,
            sourceAccountId: Number(input.sourceAccountId),
            destinationAccountId: Number(input.destinationAccountId),
            correlationId,
            amount: input.amount,
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

export * from "./schema";
export { pingDatabase } from "./ping";
export { initializeDatabase } from "./initialize";
