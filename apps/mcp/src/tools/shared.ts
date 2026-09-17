/**
 * What every tool module shares: the argument schemas, the result envelopes,
 * and the per-server values threaded through \`ToolDeps\`.
 *
 * Keeping these in one place is what stops two tools describing the same
 * argument differently, or one of them returning an error shape a client has
 * never seen.
 */
import type { Application } from "@lastro/application";
import {
  CursorPage,
  FinancialResource,
  Id,
  TransferResource,
  normalizeResource,
} from "@lastro/contracts";
import type { ExecutionContext } from "@lastro/domain";
import { z } from "zod";

export type ToolDeps = {
  application: Application;
  /** The Book this server is bound to. A credential reaches exactly one. */
  context: ExecutionContext;
  /**
   * Named Book must be the bound one. Rejecting rather than returning an empty
   * result is what makes a token for another Book an error the caller sees,
   * instead of a ledger that silently looks empty.
   */
  requireBook: (bookId: string) => void;
};

export const toolPage = z
  .object({
    bookId: Id,
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const idempotencyKey = z.string().trim().min(1).max(200);

export const writeBase = z.object({
  bookId: Id,
  idempotencyKey,
});

export const confirmation = z.literal("confirm");

export function writeResult(value: Record<string, unknown>) {
  return result(value);
}

export function confirmationRequired(action: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Confirmation required for ${action}. Re-run with confirmation: "confirm".`,
      },
    ],
    structuredContent: { confirmationRequired: true, action },
  };
}

export function resource(value: Record<string, unknown>) {
  return FinancialResource.parse(normalizeResource(value));
}

export function transferResource(value: Record<string, unknown>) {
  return TransferResource.parse(normalizeResource(value));
}

export function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function error(message: string) {
  const safe = new Set([
    "UNAUTHORIZED_OR_NOT_FOUND",
    "FORBIDDEN",
    "CONFLICT",
    "INVALID_MONEY",
    "INVALID_INSTALLMENT",
  ]);
  const code = safe.has(message) ? message : "INVALID_REQUEST";
  return { content: [{ type: "text" as const, text: code }], isError: true };
}
