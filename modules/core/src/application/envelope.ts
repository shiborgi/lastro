/**
 * The envelope every operation runs in (ADR 11).
 *
 * In order: authorization for the Book and the operation's access level, then
 * for a write the transaction, the idempotency replay or reservation, the
 * module's work, the audit events, and the commit. Modules contain only their
 * own work; tenancy, idempotency and audit cannot be forgotten because no
 * module performs them.
 */
import {
  type AuditEntry,
  ConflictError,
  type Envelope,
  type ExecutionContext,
  ForbiddenError,
  type OperationDescriptor,
  UnauthorizedError,
  type UserContext,
  canAccess,
} from "@lastro/kernel";
import type { AuditEvent } from "../domain/audit";
import type { EnvelopeStore } from "./port";

function auditEvent(
  context: ExecutionContext,
  operation: string,
  entry: AuditEntry,
): AuditEvent {
  return {
    actorType: context.actorType ?? "USER",
    actorPrincipal: context.agentPrincipal ?? context.actorId,
    delegatedOperator: context.delegatedOperator ?? context.actorId,
    bookId: context.bookId,
    source: context.source,
    correlationId: context.correlationId,
    operation,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    payload: entry.payload ?? {},
  };
}

const readOnlyAudit = (operation: string) => () => {
  throw new Error(`${operation} is a read and cannot record an audit event`);
};

export function createEnvelope(store: EnvelopeStore): Envelope {
  return {
    async run<T>(
      descriptor: OperationDescriptor,
      caller: UserContext | ExecutionContext,
      work: Parameters<Envelope["run"]>[2],
    ): Promise<T> {
      const run = work as (scope: Parameters<typeof work>[0]) => Promise<T>;

      if (descriptor.scope === "user") {
        return run({
          context: caller,
          handle: store.connection,
          audit: readOnlyAudit(descriptor.id),
        });
      }

      /*
       * The role is read from membership here, not taken from the caller:
       * whatever built the context, the Book's own record decides. A caller
       * who is not a member learns nothing about whether the Book exists.
       */
      const claimed = caller as ExecutionContext;
      const role = await store.getMembership(claimed.actorId, claimed.bookId);
      if (!role) throw new UnauthorizedError();
      if (!canAccess(role, descriptor.access)) throw new ForbiddenError();
      const context: ExecutionContext = { ...claimed, role };

      if (descriptor.access === "read") {
        return run({
          context,
          handle: store.connection,
          audit: readOnlyAudit(descriptor.id),
        });
      }

      const key = context.idempotencyKey;
      return store.transaction(async (handle) => {
        if (key) {
          await store.lockIdempotencyKey(handle, context.bookId, key);
          const stored = await store.findIdempotencyRecord(
            handle,
            context.bookId,
            key,
          );
          if (stored) {
            if (stored.operation !== descriptor.id)
              throw new ConflictError(
                "the idempotency key was already used for another operation",
              );
            return stored.result as T;
          }
        }

        const entries: AuditEntry[] = [];
        const result = await run({
          context,
          handle,
          audit: (entry) => {
            entries.push(entry);
          },
        });
        // A write nobody can trace is a defect in the module, not a refusal.
        if (entries.length === 0)
          throw new Error(`${descriptor.id} wrote without an audit event`);

        await store.insertAuditEvents(
          handle,
          entries.map((entry) => auditEvent(context, descriptor.id, entry)),
        );
        if (key)
          await store.saveIdempotencyRecord(handle, {
            bookId: context.bookId,
            key,
            operation: descriptor.id,
            result,
          });
        return result;
      });
    },
  };
}
