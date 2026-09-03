import type { Application } from "@lastro/application";
import { type AuthService, parseBearerCredential } from "@lastro/auth";
import {
  BookPosition,
  CreateExpense,
  CreateExpenseSettlement,
  CreatePayment,
  CursorPage,
  FinancialResource,
  Page,
  VoidExpenseSettlement,
} from "@lastro/contracts";
import { LastroError } from "@lastro/domain";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type HealthBody = {
  status: "ok" | "degraded";
  database: { status: "up" | "down" };
};

export function createApi(opts: {
  ping: () => Promise<boolean>;
  auth?: AuthService;
  application?: Application;
}) {
  const app = new Hono();

  const unauthorized = (c: Context) => c.json({ error: "UNAUTHORIZED" }, 401);

  async function contextFor(c: Context, requestedBookId?: string) {
    if (!opts.auth) return null;
    const bookId =
      requestedBookId ?? c.req.header("x-book-id") ?? c.req.query("bookId");
    const token = parseBearerCredential(c.req.header("authorization") ?? null);
    if (!bookId || !token) return null;
    return opts.auth.authenticateSession({
      sessionId: token.credentialId,
      secret: token.secret,
      bookId,
      source: "API",
      correlationId: c.req.header("x-correlation-id") ?? crypto.randomUUID(),
      idempotencyKey: c.req.header("idempotency-key") ?? undefined,
    });
  }

  function failure(c: Context, error: unknown) {
    if (error instanceof LastroError) {
      return c.json(
        { error: error.code },
        error.status as ContentfulStatusCode,
      );
    }
    throw error;
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

  const resource = (value: Record<string, unknown>) => {
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
      expenseId:
        value.expenseId === undefined ? undefined : String(value.expenseId),
      paymentId:
        value.paymentId === undefined ? undefined : String(value.paymentId),
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
  };

  async function v1Context(c: Context) {
    if (!opts.application) return null;
    return contextFor(c, c.req.param("bookId"));
  }

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
        amountMinor: BigInt(input.data.amountMinor),
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
        amountMinor: BigInt(input.data.amountMinor),
        occurredAt: input.data.occurredAt
          ? new Date(input.data.occurredAt)
          : undefined,
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
        amountMinor: BigInt(input.data.amountMinor),
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
              outstandingMinor: item.outstandingMinor.toString(),
              status: item.status,
            })),
            nextCursor: result.expenses.nextCursor,
          },
          totals: result.totals.map((total) => ({
            ...total,
            outstandingMinor: total.outstandingMinor.toString(),
          })),
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/books", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    try {
      return c.json({ books: await opts.application.listBooks(context) });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get("/accounts", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    try {
      return c.json({ accounts: await opts.application.listAccounts(context) });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/accounts", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "INVALID_REQUEST" }, 400);
    }
    const input = body as Record<string, unknown>;
    try {
      const account = await opts.application.createAccount({
        context,
        name: String(input.name ?? ""),
        type: String(input.type ?? ""),
      });
      return c.json({ account }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get("/parties", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    try {
      return c.json({ parties: await opts.application.listParties(context) });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/parties", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "INVALID_REQUEST" }, 400);
    }
    const input = body as Record<string, unknown>;
    try {
      const party = await opts.application.createParty({
        context,
        name: String(input.name ?? ""),
        type: String(input.type ?? ""),
      });
      return c.json({ party }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get("/expenses", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    try {
      return c.json({ expenses: await opts.application.listExpenses(context) });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post("/expenses", async (c) => {
    if (!opts.application) return unauthorized(c);
    const context = await contextFor(c);
    if (!context) return unauthorized(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "INVALID_REQUEST" }, 400);
    }
    const input = body as Record<string, unknown>;
    try {
      const expense = await opts.application.createExpense({
        context,
        accountId: String(input.accountId ?? ""),
        partyId: String(input.partyId ?? ""),
        expenseCategoryId: String(input.expenseCategoryId ?? ""),
      });
      return c.json({ expense }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

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
