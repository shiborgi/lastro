/**
 * An in-memory core, so any module's use cases can be tested through the
 * real envelope without PostgreSQL.
 */
import {
  type Envelope,
  type ExecutionContext,
  type ModuleDefinition,
  type Role,
  composeModules,
  defineModule,
} from "@lastro/kernel";
import { createEnvelope } from "./application/envelope";
import { type CoreApi, createCore } from "./application/module";
import type { CorePort, EnvelopeStore, User } from "./application/port";
import { coreOperations } from "./contracts";
import type { AuditEvent } from "./domain/audit";
import type { Book } from "./domain/books";
import type { AgentCredential } from "./domain/credentials";

export type MemoryCore = {
  store: CorePort & EnvelopeStore;
  envelope: Envelope;
  /** Committed audit events, oldest first. */
  audits: readonly AuditEvent[];
  /** How many transactions were opened, committed or not. */
  transactions: number;
};

/** `members` maps `"<bookId>:<userId>"` to that member's role. */
export function memoryCore(members: Record<string, Role> = {}): MemoryCore {
  const roles = new Map(Object.entries(members));
  const users: User[] = [];
  const books: Book[] = [];
  const credentials = new Map<string, AgentCredential>();
  let audits: AuditEvent[] = [];
  let records = new Map<string, { operation: string; result: unknown }>();
  let transactions = 0;

  const store: CorePort & EnvelopeStore = {
    connection: { memory: "connection" },
    async transaction(work) {
      transactions += 1;
      const before = { audits: [...audits], records: new Map(records) };
      try {
        return await work({ memory: "transaction" });
      } catch (error) {
        audits = before.audits;
        records = before.records;
        throw error;
      }
    },
    getMembership: async (userId, bookId) =>
      roles.get(`${bookId}:${userId}`) ?? null,
    lockIdempotencyKey: async () => {},
    findIdempotencyRecord: async (_handle, bookId, key) =>
      records.get(`${bookId}:${key}`) ?? null,
    async saveIdempotencyRecord(_handle, record) {
      records.set(`${record.bookId}:${record.key}`, {
        operation: record.operation,
        // What a database would hand back: plain data, detached from the caller.
        result: structuredClone(record.result),
      });
    },
    async insertAuditEvents(_handle, events) {
      for (const event of events)
        audits.push({
          ...event,
          id: String(audits.length + 1),
          createdAt: new Date(),
        });
    },

    listBooksOf: async (userId) =>
      books.filter((book) => roles.has(`${book.id}:${userId}`)),
    getBookByKey: async (key) => books.find((book) => book.key === key) ?? null,
    async createBook(input) {
      const book = { id: String(books.length + 1), ...input };
      books.push(book);
      return book;
    },
    getUserByEmail: async (email) =>
      users.find((user) => user.email === email) ?? null,
    async createUser(input) {
      users.push(input);
      return input;
    },
    async setBookMember(input) {
      roles.set(`${input.bookId}:${input.userId}`, input.role);
    },
    getAgentCredential: async (id) => credentials.get(id) ?? null,
    async createAgentCredential(_handle, credential) {
      credentials.set(credential.id, credential);
      return credential;
    },
    async revokeAgentCredential(_handle, id, bookId) {
      const credential = credentials.get(id);
      if (!credential || credential.bookId !== bookId || credential.revokedAt)
        return false;
      credentials.set(id, { ...credential, revokedAt: new Date() });
      return true;
    },
    listAuditEvents: async (_handle, query) =>
      audits
        .filter(
          (event) =>
            event.bookId === query.bookId &&
            (!query.action || event.action === query.action) &&
            (!query.resourceType ||
              event.resourceType === query.resourceType) &&
            (!query.resourceId || event.resourceId === query.resourceId) &&
            (!query.after || Number(event.id) > Number(query.after)),
        )
        .slice(0, query.limit),
  };

  return {
    store,
    envelope: createEnvelope(store),
    get audits() {
      return audits;
    },
    get transactions() {
      return transactions;
    },
  };
}

/** Only the envelope, for modules that need nothing else from core. */
export function memoryEnvelope(members: Record<string, Role>) {
  return memoryCore(members);
}

export const defaultMembers: Record<string, Role> = {
  "1:editor": "EDITOR",
  "1:viewer": "VIEWER",
  "2:other": "OWNER",
};

/**
 * Core over memory, inside the real envelope, with the modules given after
 * it. Each module's own test host is this with its definition in `modules`.
 */
export function coreTestHost(
  modules: readonly ModuleDefinition<null>[] = [],
  members: Record<string, Role> = defaultMembers,
) {
  const memory = memoryCore(members);
  const host = composeModules({
    modules: [
      defineModule<null, object, CoreApi>({
        id: "core",
        dependsOn: [],
        operations: coreOperations,
        create: () => createCore(memory.store),
      }),
      ...modules,
    ],
    resources: null,
    envelope: (composed) => (composed.core as CoreApi).envelope,
  });
  /** The role is read from membership; the one given here is ignored. */
  const as = (actorId: string, bookId = "1"): ExecutionContext => ({
    actorId,
    bookId,
    role: "VIEWER",
    source: "API",
    correlationId: "test",
  });
  return { host, memory, as };
}
