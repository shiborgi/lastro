/**
 * Core's PostgreSQL adapter: the envelope's storage and the identity, Book,
 * credential and audit queries.
 */
import { type Role, roles } from "@lastro/kernel";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { CorePort, EnvelopeStore } from "../application/port";
import type { AuditEvent } from "../domain/audit";
import { type Db, idNumber } from "./handle";
import * as schema from "./schema";

function role(value: string): Role {
  if (!roles.includes(value as Role)) throw new Error(`unknown role: ${value}`);
  return value as Role;
}

const bookFromRow = (row: typeof schema.books.$inferSelect) => ({
  id: String(row.id),
  key: row.key,
  name: row.name,
});

const userFromRow = (row: typeof schema.authUsers.$inferSelect) => ({
  id: row.id,
  email: row.email,
  name: row.name,
});

const credentialFromRow = (
  row: typeof schema.agentCredentials.$inferSelect,
) => ({
  id: row.id,
  bookId: String(row.bookId),
  principal: row.principal,
  delegatedOperator: row.delegatedOperator,
  secretHash: row.secretHash,
  revokedAt: row.revokedAt,
});

export function createCoreRepository(db: Db): CorePort & EnvelopeStore {
  const on = (handle: unknown) => handle as Db;

  async function getMembership(
    userId: string,
    bookId: string,
  ): Promise<Role | null> {
    // An id that is not a Book id belongs to no Book: not found, not an error.
    if (!/^\d+$/.test(bookId)) return null;
    const [row] = await db
      .select({ role: schema.bookMembers.role })
      .from(schema.bookMembers)
      .where(
        and(
          eq(schema.bookMembers.userId, userId),
          eq(schema.bookMembers.bookId, Number(bookId)),
        ),
      );
    return row ? role(row.role) : null;
  }

  return {
    connection: db,
    transaction: (work) => db.transaction((tx) => work(tx)),
    getMembership,

    /*
     * The advisory lock serialises concurrent callers of one key, so the
     * loser waits and then finds the winner's record instead of writing twice.
     */
    async lockIdempotencyKey(handle, bookId, key) {
      await on(handle).execute(
        sql`select pg_advisory_xact_lock(hashtext(${`idempotency:${bookId}:${key}`}))`,
      );
    },

    async findIdempotencyRecord(handle, bookId, key) {
      const [row] = await on(handle)
        .select()
        .from(schema.idempotencyRecords)
        .where(
          and(
            eq(schema.idempotencyRecords.bookId, idNumber(bookId, "bookId")),
            eq(schema.idempotencyRecords.key, key),
          ),
        );
      if (!row) return null;
      return {
        operation: row.operation,
        result: (row.result as { value: unknown }).value,
      };
    },

    async saveIdempotencyRecord(handle, record) {
      await on(handle)
        .insert(schema.idempotencyRecords)
        .values({
          bookId: idNumber(record.bookId, "bookId"),
          key: record.key,
          operation: record.operation,
          // Wrapped so a result of `null` is still a stored value.
          result: { value: record.result ?? null },
        });
    },

    async insertAuditEvents(handle, events) {
      if (events.length === 0) return;
      await on(handle)
        .insert(schema.auditEvents)
        .values(
          events.map((event) => ({
            actorType: event.actorType,
            actorPrincipal: event.actorPrincipal,
            delegatedOperator: event.delegatedOperator,
            bookId: idNumber(event.bookId, "bookId"),
            source: event.source,
            correlationId: event.correlationId,
            operation: event.operation,
            action: event.action,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            payload: event.payload,
          })),
        );
    },

    async listBooksOf(userId) {
      const rows = await db
        .select({ book: schema.books })
        .from(schema.books)
        .innerJoin(
          schema.bookMembers,
          eq(schema.bookMembers.bookId, schema.books.id),
        )
        .where(eq(schema.bookMembers.userId, userId))
        .orderBy(asc(schema.books.id));
      return rows.map(({ book }) => bookFromRow(book));
    },

    async getBookByKey(key) {
      const [row] = await db
        .select()
        .from(schema.books)
        .where(eq(schema.books.key, key));
      return row ? bookFromRow(row) : null;
    },

    async createBook(input) {
      const [row] = await db.insert(schema.books).values(input).returning();
      if (!row) throw new Error("book insert returned no row");
      return bookFromRow(row);
    },

    async getUserByEmail(email) {
      const [row] = await db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers.email, email));
      return row ? userFromRow(row) : null;
    },

    async createUser(input) {
      const [row] = await db.insert(schema.authUsers).values(input).returning();
      if (!row) throw new Error("user insert returned no row");
      return userFromRow(row);
    },

    async setBookMember(input) {
      await db
        .insert(schema.bookMembers)
        .values({
          bookId: idNumber(input.bookId, "bookId"),
          userId: input.userId,
          role: input.role,
        })
        .onConflictDoUpdate({
          target: [schema.bookMembers.bookId, schema.bookMembers.userId],
          set: { role: input.role },
        });
    },

    async getAgentCredential(id) {
      const [row] = await db
        .select()
        .from(schema.agentCredentials)
        .where(eq(schema.agentCredentials.id, id));
      return row ? credentialFromRow(row) : null;
    },

    async createAgentCredential(handle, credential) {
      const [row] = await on(handle)
        .insert(schema.agentCredentials)
        .values({
          ...credential,
          bookId: idNumber(credential.bookId, "bookId"),
        })
        .returning();
      if (!row) throw new Error("credential insert returned no row");
      return credentialFromRow(row);
    },

    async revokeAgentCredential(handle, id, bookId) {
      const rows = await on(handle)
        .update(schema.agentCredentials)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.agentCredentials.id, id),
            eq(schema.agentCredentials.bookId, idNumber(bookId, "bookId")),
            isNull(schema.agentCredentials.revokedAt),
          ),
        )
        .returning({ id: schema.agentCredentials.id });
      return rows.length > 0;
    },

    async listAuditEvents(handle, query) {
      const rows = await on(handle)
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.bookId, idNumber(query.bookId, "bookId")),
            query.action
              ? eq(schema.auditEvents.action, query.action)
              : undefined,
            query.resourceType
              ? eq(schema.auditEvents.resourceType, query.resourceType)
              : undefined,
            query.resourceId
              ? eq(schema.auditEvents.resourceId, query.resourceId)
              : undefined,
            query.after
              ? gt(schema.auditEvents.id, idNumber(query.after, "cursor"))
              : undefined,
          ),
        )
        .orderBy(asc(schema.auditEvents.id))
        .limit(query.limit);
      return rows.map(
        (row): AuditEvent => ({
          id: String(row.id),
          actorType: row.actorType as AuditEvent["actorType"],
          actorPrincipal: row.actorPrincipal,
          delegatedOperator: row.delegatedOperator,
          bookId: String(row.bookId),
          source: row.source as AuditEvent["source"],
          correlationId: row.correlationId,
          operation: row.operation,
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId ?? undefined,
          payload: row.payload,
          createdAt: row.createdAt,
        }),
      );
    },
  };
}
