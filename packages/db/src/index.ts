import {
  type Account,
  type AuditEvent,
  type Book,
  type Expense,
  type ExpenseCategory,
  type Party,
  type RevenueCategory,
  type Role,
  roles,
} from "@lastro/domain";
import { and, eq } from "drizzle-orm";
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
      input: Omit<Expense, "id">,
      audit: AuditEvent,
    ): Promise<Expense> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.expenses)
          .values({
            bookId: bookNumber(input.bookId),
            accountId: Number(input.accountId),
            partyId: Number(input.partyId),
            expenseCategoryId: Number(input.expenseCategoryId),
          })
          .returning();
        await tx
          .insert(schema.auditEvents)
          .values(auditValues(audit, String(row.id)));
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

    async listAuditEvents(correlationId: string) {
      return db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.correlationId, correlationId));
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
