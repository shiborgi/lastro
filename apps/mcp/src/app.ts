import type {
  Application,
  CreateAccountCommand,
  CreateCategoryCommand,
  CreateInstitutionCommand,
  CreatePartyAliasCommand,
  CreatePartyCommand,
  DeleteCommand,
  UpdateAccountCommand,
  UpdateCategoryCommand,
  UpdateInstitutionCommand,
  UpdatePartyAliasCommand,
  UpdatePartyCommand,
} from "@lastro/application";
import { type AuthService, authenticateMcpRequest } from "@lastro/auth";
import {
  BookPosition,
  CreateAccount,
  CreateCategory,
  CreateExpense,
  CreateExpenseSettlement,
  CreateInstitution,
  CreateParty,
  CreatePartyAlias,
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
  TransferResource,
  UpdateAccount,
  UpdateCategory,
  UpdateInstitution,
  UpdateParty,
  UpdatePartyAlias,
  VoidExpenseSettlement,
  VoidRevenueSettlement,
  normalizeResource,
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
  log?: (event: Record<string, unknown>) => void;
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
  return FinancialResource.parse(normalizeResource(value));
}

function transferResource(value: Record<string, unknown>) {
  return TransferResource.parse(normalizeResource(value));
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function error(message: string) {
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

export function createMcpServer(opts: McpOptions, context: ExecutionContext) {
  if (!opts.application) throw new Error("application is required");
  const application = opts.application;
  const server = new McpServer({ name: "lastro", version: "1.0.0" });
  const requireBook = (bookId: string) => {
    if (bookId !== context.bookId) throw new Error("UNAUTHORIZED_OR_NOT_FOUND");
  };

  /*
   * Catalog entities (institutions, accounts, parties, categories) are the
   * foreign keys every financial record points at. Without these an agent can
   * only reference ids it already knows, so it cannot open a Book and start
   * working — which is the whole premise of an MCP-first ledger. The four sets
   * are identical in shape, so they are registered from one description.
   */
  function registerCatalog(entity: {
    name: string;
    plural: string;
    createShape: z.ZodRawShape;
    updateShape: z.ZodRawShape;
    list: (ctx: ExecutionContext) => Promise<unknown[]>;
    create: (input: Record<string, unknown>) => Promise<unknown>;
    update: (input: Record<string, unknown>) => Promise<unknown>;
    remove: (input: Record<string, unknown>) => Promise<void>;
  }) {
    /*
     * Each entity's field shape is only known at runtime, so the SDK cannot
     * infer a callback signature from it. Zod still validates every field
     * against the registered schema before a handler runs — this alias only
     * describes the fields to TypeScript.
     */
    type CatalogArgs = {
      bookId: string;
      idempotencyKey: string;
      id: string;
      confirmation?: "confirm";
    } & Record<string, unknown>;
    const typed = (fn: (args: CatalogArgs) => unknown) =>
      fn as unknown as Parameters<typeof server.registerTool>[2];

    server.registerTool(
      `list_${entity.plural}`,
      {
        description: `List the ${entity.plural} defined in an explicitly selected Book.`,
        annotations: { readOnlyHint: true },
        inputSchema: { bookId: Id },
      },
      typed(async ({ bookId }) => {
        try {
          requireBook(bookId);
          return result({ items: await entity.list(context) });
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : "request failed",
          );
        }
      }),
    );

    server.registerTool(
      `create_${entity.name}`,
      {
        description: `Create a ${entity.name} in an explicitly selected Book.`,
        annotations: { idempotentHint: true },
        inputSchema: { bookId: Id, idempotencyKey, ...entity.createShape },
      },
      typed(async ({ bookId, idempotencyKey: key, ...input }) => {
        try {
          requireBook(bookId);
          return result(
            await entity.create({
              context: { ...context, idempotencyKey: key },
              ...input,
            }),
          );
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : "request failed",
          );
        }
      }),
    );

    server.registerTool(
      `update_${entity.name}`,
      {
        description: `Update a ${entity.name}. Only the supplied fields change.`,
        annotations: { idempotentHint: true },
        inputSchema: {
          bookId: Id,
          idempotencyKey,
          id: Id,
          ...entity.updateShape,
        },
      },
      typed(async ({ bookId, idempotencyKey: key, ...input }) => {
        try {
          requireBook(bookId);
          return result(
            await entity.update({
              context: { ...context, idempotencyKey: key },
              ...input,
            }),
          );
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : "request failed",
          );
        }
      }),
    );

    server.registerTool(
      `delete_${entity.name}`,
      {
        description: `Delete a ${entity.name}. Requires confirmation because records referencing it will block the delete.`,
        annotations: { destructiveHint: true },
        inputSchema: {
          bookId: Id,
          idempotencyKey,
          id: Id,
          confirmation: confirmation.optional(),
        },
      },
      typed(
        async ({
          bookId,
          idempotencyKey: key,
          id,
          confirmation: confirmed,
        }) => {
          try {
            requireBook(bookId);
            if (confirmed !== "confirm") {
              return confirmationRequired(`delete_${entity.name}`);
            }
            await entity.remove({
              context: { ...context, idempotencyKey: key },
              id,
            });
            return result({ deleted: true, id });
          } catch (cause) {
            return error(
              cause instanceof Error ? cause.message : "request failed",
            );
          }
        },
      ),
    );
  }

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

  registerCatalog({
    name: "institution",
    plural: "institutions",
    createShape: CreateInstitution.shape,
    updateShape: UpdateInstitution.shape,
    list: (ctx) => application.listInstitutions(ctx),
    create: (input) =>
      application.createInstitution(input as CreateInstitutionCommand),
    update: (input) =>
      application.updateInstitution(input as UpdateInstitutionCommand),
    remove: (input) => application.deleteInstitution(input as DeleteCommand),
  });

  registerCatalog({
    name: "account",
    plural: "accounts",
    createShape: CreateAccount.shape,
    updateShape: UpdateAccount.shape,
    list: (ctx) => application.listAccounts(ctx),
    create: (input) => application.createAccount(input as CreateAccountCommand),
    update: (input) => application.updateAccount(input as UpdateAccountCommand),
    remove: (input) => application.deleteAccount(input as DeleteCommand),
  });

  registerCatalog({
    name: "party",
    plural: "parties",
    createShape: CreateParty.shape,
    updateShape: UpdateParty.shape,
    list: (ctx) => application.listParties(ctx),
    create: (input) => application.createParty(input as CreatePartyCommand),
    update: (input) => application.updateParty(input as UpdatePartyCommand),
    remove: (input) => application.deleteParty(input as DeleteCommand),
  });

  registerCatalog({
    name: "party_alias",
    plural: "party_aliases",
    createShape: CreatePartyAlias.shape,
    updateShape: UpdatePartyAlias.shape,
    list: (ctx) => application.listPartyAliases(ctx),
    create: (input) =>
      application.createPartyAlias(input as CreatePartyAliasCommand),
    update: (input) =>
      application.updatePartyAlias(input as UpdatePartyAliasCommand),
    remove: (input) => application.deletePartyAlias(input as DeleteCommand),
  });

  registerCatalog({
    name: "category",
    plural: "categories",
    createShape: CreateCategory.shape,
    updateShape: UpdateCategory.shape,
    list: (ctx) => application.listCategories(ctx),
    create: (input) =>
      application.createCategory(input as CreateCategoryCommand),
    update: (input) =>
      application.updateCategory(input as UpdateCategoryCommand),
    remove: (input) => application.deleteCategory(input as DeleteCommand),
  });

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
  return server;
}

export function createMcp(opts: McpOptions) {
  const app = new Hono();
  app.all("/mcp", async (c) => {
    const startedAt = performance.now();
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as {
      method?: string;
      params?: { name?: string };
    } | null;
    const tool = body?.method === "tools/call" ? body.params?.name : undefined;
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
      const response = await transport.handleRequest(c.req.raw);
      if (tool) {
        opts.log?.({
          event: "tool.call",
          tool,
          latencyMs: Math.round(performance.now() - startedAt),
          outcome: response.status < 400 ? "ok" : "error",
        });
      }
      return response;
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
  app.get("/health/live", (c) => c.json({ status: "live" }));
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
