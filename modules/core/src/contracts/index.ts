/** Core's wire schemas and operation descriptors. Browser-safe. */
import { CursorPage, Id, IsoDate, Page, defineOperation } from "@lastro/kernel";
import { z } from "zod";

export const BookResource = z
  .object({ id: Id, key: z.string(), name: z.string() })
  .strict();
export type BookResource = z.infer<typeof BookResource>;

export const AuditEventResource = z
  .object({
    id: Id,
    actorType: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
    actorPrincipal: z.string(),
    delegatedOperator: z.string(),
    bookId: Id,
    source: z.enum(["WEB", "API", "MCP", "WORKER"]),
    correlationId: z.string(),
    operation: z.string(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()),
    createdAt: IsoDate,
  })
  .strict();
export type AuditEventResource = z.infer<typeof AuditEventResource>;

export const listBooks = defineOperation({
  id: "core.listBooks",
  scope: "user",
  access: "read",
  input: z.object({}).strict(),
  output: z.object({ items: z.array(BookResource) }).strict(),
  http: { method: "GET", path: "/books" },
  mcp: {
    name: "list_books",
    description: "List the Books the caller is a member of.",
  },
});

export const listAuditEvents = defineOperation({
  id: "core.listAuditEvents",
  access: "read",
  input: CursorPage.extend({
    action: z.string().min(1).optional(),
    resourceType: z.string().min(1).optional(),
    resourceId: z.string().min(1).optional(),
  }).strict(),
  output: Page(AuditEventResource),
  http: { method: "GET", path: "/audit-events" },
  mcp: {
    name: "list_audit_events",
    description:
      "List the Book's audit trail, oldest first: who did what, through which operation, to which record. Filter by action, resourceType or resourceId.",
  },
});

export const revokeAgentCredential = defineOperation({
  id: "core.revokeAgentCredential",
  access: "admin",
  destructive: true,
  input: z.object({ credentialId: Id }).strict(),
  output: z.object({ id: Id, revoked: z.literal(true) }).strict(),
  http: { method: "DELETE", path: "/agent-credentials/:credentialId" },
  mcp: {
    name: "revoke_agent_credential",
    description:
      "Permanently revoke one agent credential of this Book. The agent using it loses access at once; a revoked credential cannot be restored.",
  },
});

export const coreOperations = [
  listBooks,
  listAuditEvents,
  revokeAgentCredential,
] as const;
