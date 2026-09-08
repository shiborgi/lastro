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
import { type AuthService, parseBearerCredential } from "@lastro/auth";
import {
  AccountResource,
  BookPosition,
  CashFlow,
  CategoryResource,
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
  InstitutionResource,
  Page,
  PartyAliasResource,
  PartyResource,
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
import { type ExecutionContext, LastroError } from "@lastro/domain";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/*
 * The slice of Better Auth this app actually uses. Depending on the shape
 * rather than the concrete instance keeps the session seam injectable in tests
 * — the real `betterAuth(...)` return value satisfies it structurally.
 */
export type SessionProvider = {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (args: {
      headers: Headers;
    }) => Promise<{ user: { id: string } } | null>;
  };
};

export type HealthBody = {
  status: "ok" | "degraded";
  database: { status: "up" | "down" };
};

export function createApi(opts: {
  ping: () => Promise<boolean>;
  auth?: AuthService;
  application?: Application;
  sessions?: SessionProvider;
}) {
  const app = new Hono();

  if (opts.sessions) {
    const handler = opts.sessions.handler;
    app.all("/api/auth/*", (c) => handler(c.req.raw));
  }

  /*
   * Two ways in, one ExecutionContext out:
   *   - humans arrive with a Better Auth session cookie,
   *   - agents arrive with a `Bearer <credentialId>.<secret>` MCP credential.
   * Either way the role comes from Book membership, never from the caller.
   */
  async function identify(c: Context): Promise<string | null> {
    if (!opts.sessions) return null;
    const found = await opts.sessions.api.getSession({
      headers: c.req.raw.headers,
    });
    return found?.user.id ?? null;
  }

  async function contextFor(c: Context, requestedBookId?: string) {
    if (!opts.auth) return null;
    const bookId =
      requestedBookId ?? c.req.header("x-book-id") ?? c.req.query("bookId");
    if (!bookId) return null;
    const correlationId =
      c.req.header("x-correlation-id") ?? crypto.randomUUID();
    const idempotencyKey = c.req.header("idempotency-key") ?? undefined;

    const userId = await identify(c);
    if (userId) {
      return opts.auth.contextForUser({
        userId,
        bookId,
        source: "API",
        correlationId,
        idempotencyKey,
      });
    }

    // Agent credentials work here too, so scripted callers get the same
    // surface as the MCP tools without driving a browser session. The audit
    // trail still records them as ASSISTANT acting for their operator.
    const token = parseBearerCredential(c.req.header("authorization") ?? null);
    if (!token) return null;
    const agent = await opts.auth.authenticateAgent({
      ...token,
      bookId,
      source: "API",
      correlationId,
      idempotencyKey,
    });
    return agent?.context ?? null;
  }

  const v1Failure = (c: Context, error: unknown) => {
    if (error instanceof LastroError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as ContentfulStatusCode,
      );
    }
    return c.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: error instanceof Error ? error.message : "invalid request",
        },
      },
      400,
    );
  };

  const v1Unauthorized = (c: Context) =>
    c.json(
      {
        error: { code: "UNAUTHORIZED", message: "authentication is required" },
      },
      401,
    );

  async function sessionIdentity(c: Context) {
    const userId = await identify(c);
    if (userId) return { userId };
    const token = parseBearerCredential(c.req.header("authorization") ?? null);
    if (!token || !opts.auth) return null;
    // An agent lists Books as the operator it acts for; its credential is
    // bound to one Book, so this cannot widen what it can reach.
    const agent = await opts.auth.authenticateAgent(token);
    return agent ? { userId: agent.credential.delegatedOperator } : null;
  }

  const resource = (value: Record<string, unknown>) => {
    return FinancialResource.parse(normalizeResource(value));
  };

  const transferResource = (value: Record<string, unknown>) => {
    return TransferResource.parse(normalizeResource(value));
  };

  async function v1Context(c: Context) {
    if (!opts.application) return null;
    return contextFor(c, c.req.param("bookId"));
  }

  app.get("/v1/books", async (c) => {
    const identity = await sessionIdentity(c);
    if (!identity || !opts.application) return v1Unauthorized(c);
    try {
      const books = await opts.application.listAccessibleBooks({
        actorId: identity.userId,
      });
      return c.json({
        books: books.map((book) => ({ id: String(book.id), name: book.name })),
        user: { id: identity.userId },
      });
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/expenses", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.listExpensesPage({
        context,
        ...query.data,
      });
      return c.json(
        Page(FinancialResource).parse({
          items: result.items.map(resource),
          nextCursor: result.nextCursor,
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/expenses", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreateExpense.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return v1Failure(c, input.error);
    try {
      const expense = await opts.application.createExpense({
        context,
        ...input.data,
        amount: BigInt(input.data.amount),
        referenceMonth: new Date(input.data.referenceMonth),
        occurredAt: input.data.occurredAt
          ? new Date(input.data.occurredAt)
          : undefined,
      });
      return c.json(
        { expense: resource(expense as Record<string, unknown>) },
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/payments", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.listPaymentsPage({
        context,
        ...query.data,
      });
      return c.json(
        Page(FinancialResource).parse({
          items: result.items.map((item) =>
            resource(item as Record<string, unknown>),
          ),
          nextCursor: result.nextCursor,
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/payments", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreatePayment.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return v1Failure(c, input.error);
    try {
      const payment = await opts.application.createPayment({
        context,
        ...input.data,
        referenceMonth: new Date(input.data.referenceMonth),
        dueAt: new Date(input.data.dueAt),
        paidAt: input.data.paidAt ? new Date(input.data.paidAt) : undefined,
      });
      return c.json(
        { payment: resource(payment as Record<string, unknown>) },
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/expense-settlements", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.listExpenseSettlementsPage({
        context,
        ...query.data,
      });
      return c.json(
        Page(FinancialResource).parse({
          items: result.items.map((item) =>
            resource(item as Record<string, unknown>),
          ),
          nextCursor: result.nextCursor,
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/expense-settlements", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreateExpenseSettlement.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return v1Failure(c, input.error);
    try {
      const settlement = await opts.application.createExpenseSettlement({
        context,
        ...input.data,
        amount: BigInt(input.data.amount),
      });
      return c.json(
        { settlement: resource(settlement as Record<string, unknown>) },
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post(
    "/v1/books/:bookId/expense-settlements/:settlementId/void",
    async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      const input = VoidExpenseSettlement.safeParse(
        await c.req.json().catch(() => ({})),
      );
      if (!input.success) return v1Failure(c, input.error);
      try {
        const settlement = await opts.application.voidExpenseSettlement({
          context,
          id: c.req.param("settlementId"),
          ...input.data,
        });
        return c.json({
          settlement: resource(settlement as Record<string, unknown>),
        });
      } catch (error) {
        return v1Failure(c, error);
      }
    },
  );

  app.get("/v1/books/:bookId/revenues", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.listRevenuesPage({
        context,
        ...query.data,
      });
      return c.json(
        Page(FinancialResource).parse({
          items: result.items.map((item) =>
            resource(item as Record<string, unknown>),
          ),
          nextCursor: result.nextCursor,
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/revenues", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreateRevenue.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return v1Failure(c, input.error);
    try {
      const revenue = await opts.application.createRevenue({
        context,
        ...input.data,
        amount: BigInt(input.data.amount),
        referenceMonth: new Date(input.data.referenceMonth),
        occurredAt: input.data.occurredAt
          ? new Date(input.data.occurredAt)
          : undefined,
      });
      return c.json(
        { revenue: resource(revenue as Record<string, unknown>) },
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/receipts", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.listReceiptsPage({
        context,
        ...query.data,
      });
      return c.json(
        Page(FinancialResource).parse({
          items: result.items.map((item) =>
            resource(item as Record<string, unknown>),
          ),
          nextCursor: result.nextCursor,
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/receipts", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreateReceipt.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return v1Failure(c, input.error);
    try {
      const receipt = await opts.application.createReceipt({
        context,
        ...input.data,
        amount: BigInt(input.data.amount),
        referenceMonth: new Date(input.data.referenceMonth),
        dueAt: new Date(input.data.dueAt),
        paidAt: input.data.paidAt ? new Date(input.data.paidAt) : undefined,
      });
      return c.json(
        { receipt: resource(receipt as Record<string, unknown>) },
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/revenue-settlements", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.listRevenueSettlementsPage({
        context,
        ...query.data,
      });
      return c.json(
        Page(FinancialResource).parse({
          items: result.items.map((item) =>
            resource(item as Record<string, unknown>),
          ),
          nextCursor: result.nextCursor,
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/revenue-settlements", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreateRevenueSettlement.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return v1Failure(c, input.error);
    try {
      const settlement = await opts.application.createRevenueSettlement({
        context,
        ...input.data,
        amount: BigInt(input.data.amount),
      });
      return c.json(
        { settlement: resource(settlement as Record<string, unknown>) },
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post(
    "/v1/books/:bookId/revenue-settlements/:settlementId/void",
    async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      const input = VoidRevenueSettlement.safeParse(
        await c.req.json().catch(() => ({})),
      );
      if (!input.success) return v1Failure(c, input.error);
      try {
        const settlement = await opts.application.voidRevenueSettlement({
          context,
          id: c.req.param("settlementId"),
          ...input.data,
        });
        return c.json({
          settlement: resource(settlement as Record<string, unknown>),
        });
      } catch (error) {
        return v1Failure(c, error);
      }
    },
  );

  app.get("/v1/books/:bookId/revenue-position", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.getRevenuePosition({
        context,
        ...query.data,
      });
      return c.json(
        RevenuePosition.parse({
          revenues: {
            items: result.revenues.items.map((item) => ({
              revenue: resource(item.revenue as Record<string, unknown>),
              outstanding: item.outstanding.toString(),
              status: item.status,
            })),
            nextCursor: result.revenues.nextCursor,
          },
          totals: result.totals.map((total) => ({
            ...total,
            outstanding: total.outstanding.toString(),
          })),
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/transfers", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const input = CreateTransfer.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return v1Failure(c, input.error);
    try {
      const transfer = await opts.application.createTransfer({
        context,
        ...input.data,
        amount: BigInt(input.data.amount),
        referenceMonth: new Date(input.data.referenceMonth),
      });
      return c.json(transferResource(transfer as Record<string, unknown>), 201);
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/transfers", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    try {
      const transfers = await opts.application.listTransfers(context);
      return c.json({
        items: transfers.map((transfer) =>
          transferResource(transfer as Record<string, unknown>),
        ),
      });
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/position", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const query = CursorPage.safeParse(c.req.query());
    if (!query.success) return v1Failure(c, query.error);
    try {
      const result = await opts.application.getBookPosition({
        context,
        ...query.data,
      });
      return c.json(
        BookPosition.parse({
          expenses: {
            items: result.expenses.items.map((item) => ({
              expense: resource(item.expense as Record<string, unknown>),
              outstanding: item.outstanding.toString(),
              status: item.status,
            })),
            nextCursor: result.expenses.nextCursor,
          },
          totals: result.totals.map((total) => ({
            ...total,
            outstanding: total.outstanding.toString(),
          })),
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/cash-flow", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    try {
      const flow = await opts.application.getCashFlow(context);
      return c.json(
        CashFlow.parse({
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
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  /*
   * Catalog CRUD. These four resources behave identically — list, create,
   * patch, delete, all Book-scoped — so they are registered from one
   * description rather than four near-identical copies. PATCH only touches the
   * fields present in the body; the update schemas reject an empty one.
   */
  function registerCatalogRoutes(entity: {
    path: string;
    resource: z.ZodType<Record<string, unknown>>;
    create: z.ZodType<Record<string, unknown>>;
    update: z.ZodType<Record<string, unknown>>;
    list: (context: ExecutionContext) => Promise<unknown[]>;
    add: (input: Record<string, unknown>) => Promise<unknown>;
    edit: (input: Record<string, unknown>) => Promise<unknown>;
    remove: (input: Record<string, unknown>) => Promise<void>;
  }) {
    const base = `/v1/books/:bookId/${entity.path}`;

    app.get(base, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      try {
        const items = await entity.list(context);
        return c.json({
          items: items.map((item) =>
            entity.resource.parse(
              normalizeResource(item as Record<string, unknown>),
            ),
          ),
        });
      } catch (error) {
        return v1Failure(c, error);
      }
    });

    app.post(base, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      const input = entity.create.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success) return v1Failure(c, input.error);
      try {
        const created = await entity.add({ context, ...input.data });
        return c.json(
          entity.resource.parse(
            normalizeResource(created as Record<string, unknown>),
          ),
          201,
        );
      } catch (error) {
        return v1Failure(c, error);
      }
    });

    app.patch(`${base}/:id`, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      const input = entity.update.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success) return v1Failure(c, input.error);
      try {
        const updated = await entity.edit({
          context,
          id: c.req.param("id"),
          ...input.data,
        });
        return c.json(
          entity.resource.parse(
            normalizeResource(updated as Record<string, unknown>),
          ),
        );
      } catch (error) {
        return v1Failure(c, error);
      }
    });

    app.delete(`${base}/:id`, async (c) => {
      const context = await v1Context(c);
      if (!context || !opts.application) return v1Unauthorized(c);
      try {
        await entity.remove({ context, id: c.req.param("id") });
        return c.body(null, 204);
      } catch (error) {
        return v1Failure(c, error);
      }
    });
  }

  if (opts.application) {
    const application = opts.application;
    registerCatalogRoutes({
      path: "institutions",
      resource: InstitutionResource,
      create: CreateInstitution,
      update: UpdateInstitution,
      list: (context) => application.listInstitutions(context),
      add: (input) =>
        application.createInstitution(input as CreateInstitutionCommand),
      edit: (input) =>
        application.updateInstitution(input as UpdateInstitutionCommand),
      remove: (input) => application.deleteInstitution(input as DeleteCommand),
    });

    registerCatalogRoutes({
      path: "accounts",
      resource: AccountResource,
      create: CreateAccount,
      update: UpdateAccount,
      list: (context) => application.listAccounts(context),
      add: (input) => application.createAccount(input as CreateAccountCommand),
      edit: (input) => application.updateAccount(input as UpdateAccountCommand),
      remove: (input) => application.deleteAccount(input as DeleteCommand),
    });

    registerCatalogRoutes({
      path: "parties",
      resource: PartyResource,
      create: CreateParty,
      update: UpdateParty,
      list: (context) => application.listParties(context),
      add: (input) => application.createParty(input as CreatePartyCommand),
      edit: (input) => application.updateParty(input as UpdatePartyCommand),
      remove: (input) => application.deleteParty(input as DeleteCommand),
    });

    registerCatalogRoutes({
      path: "party-aliases",
      resource: PartyAliasResource,
      create: CreatePartyAlias,
      update: UpdatePartyAlias,
      list: (context) => application.listPartyAliases(context),
      add: (input) =>
        application.createPartyAlias(input as CreatePartyAliasCommand),
      edit: (input) =>
        application.updatePartyAlias(input as UpdatePartyAliasCommand),
      remove: (input) => application.deletePartyAlias(input as DeleteCommand),
    });

    registerCatalogRoutes({
      path: "categories",
      resource: CategoryResource,
      create: CreateCategory,
      update: UpdateCategory,
      list: (context) => application.listCategories(context),
      add: (input) =>
        application.createCategory(input as CreateCategoryCommand),
      edit: (input) =>
        application.updateCategory(input as UpdateCategoryCommand),
      remove: (input) => application.deleteCategory(input as DeleteCommand),
    });
  }

  app.get("/health", async (c) => {
    const up = await opts.ping();
    const body: HealthBody = {
      status: up ? "ok" : "degraded",
      database: { status: up ? "up" : "down" },
    };
    return c.json(body, up ? 200 : 503);
  });
  return app;
}
