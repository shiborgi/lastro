/** Core's use cases over its port, and the handlers of its operations. */
import {
  type BoundOperation,
  type Envelope,
  type ExecutionContext,
  type Scope,
  UnauthorizedError,
  bind,
} from "@lastro/kernel";
import {
  listAuditEvents,
  listBooks,
  revokeAgentCredential,
} from "../contracts";
import type { AuditEvent } from "../domain/audit";
import { createAdmin } from "./admin";
import { createEnvelope } from "./envelope";
import { createIdentity } from "./identity";
import type { AuditQuery, CorePort, EnvelopeStore } from "./port";

export type CoreApi = {
  /** Runs every operation of the host (ADR 11). */
  envelope: Envelope;
  identity: ReturnType<typeof createIdentity>;
  admin: ReturnType<typeof createAdmin>;
  audit: {
    /** The Book's audit events, oldest first, within the caller's unit of work. */
    list(
      scope: Scope<ExecutionContext>,
      query: Omit<AuditQuery, "bookId">,
    ): Promise<AuditEvent[]>;
  };
};

export function createCore(port: CorePort & EnvelopeStore): {
  api: CoreApi;
  handlers: readonly BoundOperation[];
} {
  const audit: CoreApi["audit"] = {
    list: (scope, query) =>
      port.listAuditEvents(scope.handle, {
        ...query,
        bookId: scope.context.bookId,
      }),
  };

  return {
    api: {
      envelope: createEnvelope(port),
      identity: createIdentity(port),
      admin: createAdmin(port),
      audit,
    },
    handlers: [
      bind(listBooks, async ({ scope }) => ({
        items: await port.listBooksOf(scope.context.actorId),
      })),

      bind(listAuditEvents, async ({ scope, input }) => {
        const { cursor, limit, ...filter } = input;
        const items = await audit.list(scope, {
          ...filter,
          after: cursor,
          limit,
        });
        return {
          items,
          nextCursor:
            items.length === limit ? (items.at(-1)?.id ?? null) : null,
        };
      }),

      bind(revokeAgentCredential, async ({ scope, input }) => {
        const revoked = await port.revokeAgentCredential(
          scope.handle,
          input.credentialId,
          scope.context.bookId,
        );
        // Unknown, another Book's, or already revoked: one answer for all.
        if (!revoked) throw new UnauthorizedError();
        scope.audit({
          action: "agent_credential.revoked",
          resourceType: "agent_credential",
          resourceId: input.credentialId,
        });
        return { id: input.credentialId, revoked: true };
      }),
    ],
  };
}
