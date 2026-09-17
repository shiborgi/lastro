/**
 * The expense and revenue cycles, transfers, positions and cash flow.
 *
 * Every write takes a mandatory idempotency key and every void demands an
 * explicit confirmation — an agent cannot undo money by accident.
 */
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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type ToolDeps,
  confirmation,
  confirmationRequired,
  error,
  idempotencyKey,
  resource,
  result,
  toolPage,
  transferResource,
  writeBase,
  writeResult,
} from "./shared";

export function register(server: McpServer, deps: ToolDeps) {
  const { application, context, requireBook } = deps;
  server.registerTool(
    "list_transfers",
    {
      description: "List transfers recorded in an explicitly selected Book.",
      annotations: { readOnlyHint: true },
      inputSchema: { bookId: Id },
    },
    async ({ bookId }) => {
      try {
        requireBook(bookId);
        const transfers = await application.listTransfers(context);
        return result({
          items: transfers.map((item) =>
            transferResource(item as unknown as Record<string, unknown>),
          ),
        });
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
    "get_expense_position",
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
                outstanding: item.outstanding.toString(),
                status: item.status,
              })),
              nextCursor: position.expenses.nextCursor,
            },
            totals: position.totals.map((total) => ({
              ...total,
              outstanding: total.outstanding.toString(),
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
                outstanding: item.outstanding.toString(),
                status: item.status,
              })),
              nextCursor: position.revenues.nextCursor,
            },
            totals: position.totals.map((total) => ({
              ...total,
              outstanding: total.outstanding.toString(),
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
            amount: item.amount.toString(),
          })),
          outflows: flow.outflows.map((item) => ({
            ...item,
            amount: item.amount.toString(),
          })),
          transfers: flow.transfers.map((item) => ({
            ...item,
            amount: item.amount.toString(),
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
          amount: BigInt(rest.amount),
          referenceMonth: new Date(rest.referenceMonth),
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
          referenceMonth: new Date(rest.referenceMonth),
          dueAt: new Date(rest.dueAt),
          paidAt: rest.paidAt ? new Date(rest.paidAt) : undefined,
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
          amount: BigInt(rest.amount),
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
          amount: BigInt(rest.amount),
          referenceMonth: new Date(rest.referenceMonth),
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
          amount: BigInt(rest.amount),
          referenceMonth: new Date(rest.referenceMonth),
          dueAt: new Date(rest.dueAt),
          paidAt: rest.paidAt ? new Date(rest.paidAt) : undefined,
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
          amount: BigInt(rest.amount),
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
          amount: BigInt(rest.amount),
          referenceMonth: new Date(rest.referenceMonth),
          occurredAt: rest.occurredAt ? new Date(rest.occurredAt) : undefined,
        });
        return writeResult({
          transfer: transferResource(transfer as Record<string, unknown>),
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
      annotations: { destructiveHint: true },
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
      annotations: { destructiveHint: true },
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
}
