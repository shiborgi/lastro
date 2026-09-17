/**
 * Statement staging and review.
 *
 * These tools record what a bank file said and let a person review it; none of
 * them creates an economic fact (ADR 8). `import_statement` takes the bytes
 * because the caller is the one with access to the storage — an agent reaching
 * a Drive folder transports the file and never interprets it.
 */
import {
  AccountMovementResource,
  CardMovementResource,
  Id,
  ImportStatement,
  ImportSummary,
  MovementStatus,
  PendingAccountDescriptorResource,
  PendingCardDescriptorResource,
  PostMovement,
  PostedMovement,
  ReviewMovement,
  movementResource,
} from "@lastro/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type ToolDeps,
  error,
  idempotencyKey,
  result,
  writeBase,
  writeResult,
} from "./shared";

export function register(server: McpServer, deps: ToolDeps) {
  const { application, context, requireBook } = deps;
  /*
   * Statement staging. These tools record what a bank file said and let a
   * person review it; none of them creates an economic fact. `import_statement`
   * takes the bytes because the caller is the one with access to the storage —
   * an agent reaching a Drive folder transports the file and never interprets
   * it, so every route into the ledger reads a format the same way.
   */
  server.registerTool(
    "import_statement",
    {
      description:
        "Stage a bank statement CSV into an explicitly selected Book. `accountId` says which account the file belongs to and is required — it is never inferred from a row, because one export prints no account number and a card invoice carries two card numbers that are two plastics on one credit account. Rows land PENDING; descriptors the import has never seen are recorded without a destination for you to map, per account. Re-importing the same file inserts nothing. Path must be <institution>/<kind>/<file>, and the institution must already exist in the Book.",
      inputSchema: writeBase.merge(ImportStatement),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const summary = await application.importStatement({
          context: { ...context, idempotencyKey },
          ...rest,
        });
        return writeResult(ImportSummary.parse(summary));
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_card_movements",
    {
      description:
        "List staged card-statement rows in an explicitly selected Book. `amount` keeps the statement's sign: positive is a charge, negative a credit or bill payment.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id, status: MovementStatus.optional() },
    },
    async ({ bookId, status }) => {
      try {
        requireBook(bookId);
        const items = await application.listCardMovements({
          context,
          status,
        });
        return result({
          items: items.map((item) =>
            CardMovementResource.parse(movementResource(item)),
          ),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_account_movements",
    {
      description:
        "List staged account-statement rows in an explicitly selected Book. `amount` keeps the statement's sign: positive is money in, negative money out — the opposite convention from a card.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id, status: MovementStatus.optional() },
    },
    async ({ bookId, status }) => {
      try {
        requireBook(bookId);
        const items = await application.listAccountMovements({
          context,
          status,
        });
        return result({
          items: items.map((item) =>
            AccountMovementResource.parse(movementResource(item)),
          ),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "review_movement",
    {
      description:
        "Set a staged row to IGNORED, or back to PENDING. Use IGNORED for lines that are not economic facts — a credit-card bill payment appears on both the invoice and the account statement as one event seen from two sides. Posting is a separate operation because it creates an expense.",
      annotations: { idempotentHint: true },
      inputSchema: writeBase.merge(ReviewMovement),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        await application.reviewMovement({
          context: { ...context, idempotencyKey },
          ...rest,
        });
        return writeResult({ id: rest.id, status: rest.status });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "post_movement",
    {
      description:
        "Promote a reviewed row into the ledger. The sign decides what it becomes — money out is an expense, money in a revenue — and the party and category come from the descriptor's mapping, so a descriptor that is not mapped yet is refused rather than guessed. `referenceMonth` is required because it belongs to the invoice, not the purchase: an instalment bought in April sits on a September statement.",
      inputSchema: writeBase.merge(PostMovement),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const {
          bookId: _bookId,
          idempotencyKey,
          referenceMonth,
          ...rest
        } = input;
        const posted = await application.postMovement({
          context: { ...context, idempotencyKey },
          ...rest,
          referenceMonth: new Date(referenceMonth),
        });
        return writeResult(
          PostedMovement.parse({ ...posted, amount: posted.amount.toString() }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_pending_card_descriptors",
    {
      description:
        "Card-invoice descriptors in an explicitly selected Book that still lack a party or a category, with the evidence for deciding: how many movements point at each, what they total, when they ran, and how the issuer itself classified them. The issuer's classification is a hint and is never applied — a real invoice files 'BRASTEMP BY CULLIGAN' under Aluguel.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id },
    },
    async ({ bookId }) => {
      try {
        requireBook(bookId);
        const items = await application.listPendingCardDescriptors(context);
        return result({
          items: items.map((item) =>
            PendingCardDescriptorResource.parse({
              ...item,
              total: item.total.toString(),
              firstSeen: item.firstSeen?.toISOString() ?? null,
              lastSeen: item.lastSeen?.toISOString() ?? null,
            }),
          ),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_pending_account_descriptors",
    {
      description:
        "Account-statement descriptors in an explicitly selected Book that still lack what their destination needs — a party, a category and a method, or for a declared transfer the account on the other side. Carries the same evidence as the card queue, including the bank's own transaction type as a hint that is never applied.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id },
    },
    async ({ bookId }) => {
      try {
        requireBook(bookId);
        const items = await application.listPendingAccountDescriptors(context);
        return result({
          items: items.map((item) =>
            PendingAccountDescriptorResource.parse({
              ...item,
              total: item.total.toString(),
              firstSeen: item.firstSeen?.toISOString() ?? null,
              lastSeen: item.lastSeen?.toISOString() ?? null,
            }),
          ),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );
}
