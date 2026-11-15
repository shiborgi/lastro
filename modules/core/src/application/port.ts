/**
 * Core's own persistence port. Every member is required: an adapter that
 * cannot answer one does not typecheck.
 */
import type { Role } from "@lastro/kernel";
import type { AuditEvent } from "../domain/audit";
import type { Book } from "../domain/books";
import type { AgentCredential } from "../domain/credentials";

/** What the write envelope needs from storage. */
export type EnvelopeStore = {
  /** The handle reads run on, outside any transaction. */
  connection: unknown;
  /** Run `work` in one transaction; a throw rolls everything back. */
  transaction<T>(work: (handle: unknown) => Promise<T>): Promise<T>;
  getMembership(userId: string, bookId: string): Promise<Role | null>;
  /** Queue concurrent callers of one key until this transaction ends. */
  lockIdempotencyKey(
    handle: unknown,
    bookId: string,
    key: string,
  ): Promise<void>;
  findIdempotencyRecord(
    handle: unknown,
    bookId: string,
    key: string,
  ): Promise<{ operation: string; result: unknown } | null>;
  saveIdempotencyRecord(
    handle: unknown,
    record: { bookId: string; key: string; operation: string; result: unknown },
  ): Promise<void>;
  insertAuditEvents(
    handle: unknown,
    events: readonly AuditEvent[],
  ): Promise<void>;
};

/** Identity, Books, membership, credentials and the audit trail. */
export type CorePort = {
  getMembership(userId: string, bookId: string): Promise<Role | null>;
  listBooksOf(userId: string): Promise<Book[]>;
  getBookByKey(key: string): Promise<Book | null>;
  createBook(input: { key: string; name: string }): Promise<Book>;
  getUserByEmail(email: string): Promise<User | null>;
  createUser(input: { id: string; email: string; name: string }): Promise<User>;
  /** Ensure this role: a second call with another role rewrites the first. */
  setBookMember(input: {
    bookId: string;
    userId: string;
    role: Role;
  }): Promise<void>;
  getAgentCredential(id: string): Promise<AgentCredential | null>;
  createAgentCredential(
    handle: unknown,
    credential: AgentCredential,
  ): Promise<AgentCredential>;
  /** False when no active credential of that Book has the id. */
  revokeAgentCredential(
    handle: unknown,
    id: string,
    bookId: string,
  ): Promise<boolean>;
  listAuditEvents(handle: unknown, query: AuditQuery): Promise<AuditEvent[]>;
};

export type User = { id: string; email: string; name: string };

export type AuditQuery = {
  bookId: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  /** Only events with an id greater than this one. */
  after?: string;
  limit: number;
};
