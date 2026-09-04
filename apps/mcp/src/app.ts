import type { Application } from "@lastro/application";
import { type AuthService, authenticateMcpRequest } from "@lastro/auth";
import {
  BookPosition,
  CreateExpense,
  CreateExpenseSettlement,
  CreatePayment,
  CreateReceipt,
  CreateRevenue,
  CreateRevenueSettlement,
  CreateTransfer,
  CursorPage,
  FinancialResource,
  Id,
  Page,
  RevenuePosition,
  VoidExpenseSettlement,
  VoidRevenueSettlement,
} from "@lastro/contracts";
import type { ExecutionContext } from "@lastro/domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { z } from "zod";

type McpOptions = {
  ping: () => Promise<boolean>;
  auth?: AuthService;
  application?: Application;
};

const toolPage = z
  .object({
    bookId: Id,
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

const idempotencyKey = z.string().trim().min(1).max(200);

const writeBase = z.object({
  bookId: Id,
  idempotencyKey,
});

const confirmation = z.literal("confirm");

function writeResult(value: Record<string, unknown>) {
  return result(value);
}

function confirmationRequired(action: string) {
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

function resource(value: Record<string, unknown>) {
  const {
    installmentNumber: _installmentNumber,
    installmentCount: _installmentCount,
    ...rest
  } = value;
  return FinancialResource.parse({
    ...rest,
    id: String(value.id),
    bookId: String(value.bookId),
    accountId:
      value.accountId === undefined ? undefined : String(value.accountId),
    partyId: value.partyId == null ? value.partyId : String(value.partyId),
    expenseCategoryId:
      value.expenseCategoryId === undefined
        ? undefined
        : String(value.expenseCategoryId),
    revenueCategoryId:
      value.revenueCategoryId === undefined
        ? undefined
        : String(value.revenueCategoryId),
    expenseId:
      value.expenseId === undefined ? undefined : String(value.expenseId),
    paymentId:
      value.paymentId === undefined ? undefined : String(value.paymentId),
    revenueId:
      value.revenueId === undefined ? undefined : String(value.revenueId),
    receiptId:
      value.receiptId === undefined ? undefined : String(value.receiptId),
    amountMinor: String(value.amountMinor),
    occurredAt:
      value.occurredAt instanceof Date
        ? value.occurredAt.toISOString()
        : undefined,
    createdAt:
      value.createdAt instanceof Date
        ? value.createdAt.toISOString()
        : undefined,
    voidedAt:
      value.voidedAt instanceof Date
        ? value.voidedAt.toISOString()
        : value.voidedAt,
  });
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createMcpServer(opts: McpOptions, context: ExecutionContext) {
  if (!opts.application) throw new Error("application is required");
  const application = opts.application;
  const server = new McpServer({ name: "lastro", version: "1.6.0" });
  const requireBook = (bookId: string) => {
    if (bookId !== context.bookId) throw new Error("UNAUTHORIZED_OR_NOT_FOUND");
  };

  server.registerTool(
    "list_books",
    {
      description: "List the authenticated actor's accessible Books.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id },
    },
    async ({ bookId }) => {
      try {
        requireBook(bookId);
        return result({ books: await application.listBooks(context) });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_expenses",
    {
      description:
        "List expenses in an explicitly selected Book using cursor pagination.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const page = await application.listExpensesPage({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          Page(FinancialResource).parse({
            items: page.items.map((item) =>
              resource(item as Record<string, unknown>),
            ),
            nextCursor: page.nextCursor,
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_payments",
    {
      description:
        "List payments in an explicitly selected Book using cursor pagination.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const page = await application.listPaymentsPage({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          Page(FinancialResource).parse({
            items: page.items.map((item) =>
              resource(item as Record<string, unknown>),
            ),
            nextCursor: page.nextCursor,
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_expense_settlements",
    {
      description:
        "List expense settlements in an explicitly selected Book using cursor pagination.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const page = await application.listExpenseSettlementsPage({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          Page(FinancialResource).parse({
            items: page.items.map((item) =>
              resource(item as Record<string, unknown>),
            ),
            nextCursor: page.nextCursor,
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "get_book_position",
    {
      description:
        "Get outstanding expense position for an explicitly selected Book.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const position = await application.getBookPosition({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          BookPosition.parse({
            expenses: {
              items: position.expenses.items.map((item) => ({
                expense: resource(item.expense as Record<string, unknown>),
                outstandingMinor: item.outstandingMinor.toString(),
                status: item.status,
              })),
              nextCursor: position.expenses.nextCursor,
            },
            totals: position.totals.map((total) => ({
              ...total,
              outstandingMinor: total.outstandingMinor.toString(),
            })),
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_revenues",
    {
      description:
        "List revenues in an explicitly selected Book using cursor pagination.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const page = await application.listRevenuesPage({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          Page(FinancialResource).parse({
            items: page.items.map((item) =>
              resource(item as Record<string, unknown>),
            ),
            nextCursor: page.nextCursor,
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_receipts",
    {
      description:
        "List receipts in an explicitly selected Book using cursor pagination.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const page = await application.listReceiptsPage({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          Page(FinancialResource).parse({
            items: page.items.map((item) =>
              resource(item as Record<string, unknown>),
            ),
            nextCursor: page.nextCursor,
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "list_revenue_settlements",
    {
      description:
        "List revenue settlements in an explicitly selected Book using cursor pagination.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const page = await application.listRevenueSettlementsPage({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          Page(FinancialResource).parse({
            items: page.items.map((item) =>
              resource(item as Record<string, unknown>),
            ),
            nextCursor: page.nextCursor,
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "get_revenue_position",
    {
      description:
        "Get outstanding revenue position for an explicitly selected Book.",
      annotations: { readOnlyHint: true },
      inputSchema: toolPage.shape,
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, ...query } = input;
        const position = await application.getRevenuePosition({
          context,
          ...CursorPage.parse(query),
        });
        return result(
          RevenuePosition.parse({
            revenues: {
              items: position.revenues.items.map((item) => ({
                revenue: resource(item.revenue as Record<string, unknown>),
                outstandingMinor: item.outstandingMinor.toString(),
                status: item.status,
              })),
              nextCursor: position.revenues.nextCursor,
            },
            totals: position.totals.map((total) => ({
              ...total,
              outstandingMinor: total.outstandingMinor.toString(),
            })),
          }),
        );
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "get_cash_flow",
    {
      description:
        "Get cash inflows, outflows, and internal transfers for an explicitly selected Book.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id },
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const flow = await application.getCashFlow(context);
        return result({
          inflows: flow.inflows.map((item) => ({
            ...item,
            amountMinor: item.amountMinor.toString(),
          })),
          outflows: flow.outflows.map((item) => ({
            ...item,
            amountMinor: item.amountMinor.toString(),
          })),
          transfers: flow.transfers.map((item) => ({
            ...item,
            amountMinor: item.amountMinor.toString(),
          })),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "create_expense",
    {
      description:
        "Create an expense in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreateExpense),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const expense = await application.createExpense({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
          occurredAt: rest.occurredAt ? new Date(rest.occurredAt) : undefined,
        });
        return writeResult({
          expense: resource(expense as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "create_payment",
    {
      description:
        "Create a payment in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreatePayment),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const payment = await application.createPayment({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
          occurredAt: rest.occurredAt ? new Date(rest.occurredAt) : undefined,
        });
        return writeResult({
          payment: resource(payment as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "settle_expense_with_payment",
    {
      description:
        "Settle an expense with a payment in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreateExpenseSettlement),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const settlement = await application.createExpenseSettlement({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
        });
        return writeResult({
          settlement: resource(settlement as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "create_revenue",
    {
      description:
        "Create a revenue in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreateRevenue),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const revenue = await application.createRevenue({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
          occurredAt: rest.occurredAt ? new Date(rest.occurredAt) : undefined,
        });
        return writeResult({
          revenue: resource(revenue as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "create_receipt",
    {
      description:
        "Create a receipt in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreateReceipt),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const receipt = await application.createReceipt({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
          occurredAt: rest.occurredAt ? new Date(rest.occurredAt) : undefined,
        });
        return writeResult({
          receipt: resource(receipt as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "settle_revenue_with_receipt",
    {
      description:
        "Settle a revenue with a receipt in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreateRevenueSettlement),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const settlement = await application.createRevenueSettlement({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
        });
        return writeResult({
          settlement: resource(settlement as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "create_transfer",
    {
      description:
        "Create an internal transfer in an explicitly selected Book. Requires an idempotency key.",
      inputSchema: writeBase.merge(CreateTransfer),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        const { bookId: _bookId, idempotencyKey, ...rest } = input;
        const transfer = await application.createTransfer({
          context: { ...context, idempotencyKey },
          ...rest,
          amountMinor: BigInt(rest.amountMinor),
        });
        return writeResult({
          transfer: {
            id: String(transfer.id),
            bookId: String(transfer.bookId),
            sourcePaymentId: String(transfer.sourcePaymentId),
            destinationReceiptId: String(transfer.destinationReceiptId),
            correlationId: transfer.correlationId,
            amountMinor: String(transfer.amountMinor),
            currency: transfer.currency,
          },
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "void_expense_settlement",
    {
      description:
        "Void an expense settlement in an explicitly selected Book. Requires confirmation.",
      inputSchema: writeBase
        .merge(VoidExpenseSettlement)
        .extend({ settlementId: Id, confirmation: confirmation.optional() }),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        if (input.confirmation !== "confirm") {
          return confirmationRequired("void_expense_settlement");
        }
        const {
          bookId: _bookId,
          idempotencyKey,
          confirmation: _c,
          settlementId,
          ...rest
        } = input;
        const settlement = await application.voidExpenseSettlement({
          context: { ...context, idempotencyKey },
          id: settlementId,
          ...rest,
        });
        return writeResult({
          settlement: resource(settlement as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );

  server.registerTool(
    "void_revenue_settlement",
    {
      description:
        "Void a revenue settlement in an explicitly selected Book. Requires confirmation.",
      inputSchema: writeBase
        .merge(VoidRevenueSettlement)
        .extend({ settlementId: Id, confirmation: confirmation.optional() }),
    },
    async (input) => {
      try {
        requireBook(input.bookId);
        if (input.confirmation !== "confirm") {
          return confirmationRequired("void_revenue_settlement");
        }
        const {
          bookId: _bookId,
          idempotencyKey,
          confirmation: _c,
          settlementId,
          ...rest
        } = input;
        const settlement = await application.voidRevenueSettlement({
          context: { ...context, idempotencyKey },
          id: settlementId,
          ...rest,
        });
        return writeResult({
          settlement: resource(settlement as Record<string, unknown>),
        });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : "request failed");
      }
    },
  );
  return server;
}

export function createMcp(opts: McpOptions) {
  const app = new Hono();
  app.all("/mcp", async (c) => {
    if (!opts.auth || !opts.application)
      return c.json({ error: "UNAUTHORIZED_OR_NOT_FOUND" }, 404);
    const authenticated = await authenticateMcpRequest(
      c.req.raw,
      opts.auth,
      c.req.header("x-book-id") ?? undefined,
    );
    if (!authenticated)
      return c.json({ error: "UNAUTHORIZED_OR_NOT_FOUND" }, 404);
    const context = c.req.header("x-correlation-id")
      ? {
          ...authenticated.context,
          correlationId: c.req.header("x-correlation-id") as string,
        }
      : authenticated.context;
    const server = createMcpServer(opts, context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  app.get("/health", async (c) => {
    const up = await opts.ping();
    return c.json(
      {
        status: up ? "ok" : "degraded",
        database: { status: up ? "up" : "down" },
      },
      up ? 200 : 503,
    );
  });
  return app;
}

export async function startStdioMcp(
  opts: McpOptions,
  input: { bearer: string; bookId: string },
) {
  if (!opts.auth) throw new Error("auth is required");
  const token = input.bearer.startsWith("Bearer ")
    ? input.bearer.slice(7)
    : input.bearer;
  const separator = token.indexOf(".");
  if (separator <= 0) throw new Error("MCP_BEARER_TOKEN is invalid");
  const authenticated = await opts.auth.authenticateAgent({
    credentialId: token.slice(0, separator),
    secret: token.slice(separator + 1),
    bookId: input.bookId,
  });
  if (!authenticated) throw new Error("MCP credential is unauthorized");
  const server = createMcpServer(opts, authenticated.context);
  await server.connect(new StdioServerTransport());
  return server;
}
