/**
 * The expense and revenue cycles, transfers, and the positions read over them.
 *
 * Every handler is Book-scoped through `v1Context`, and every amount crosses
 * the wire as a decimal string — the resource schemas are what enforce that.
 */
import {
  BookPosition,
  CashFlow,
  CreateExpense,
  CreateExpenseSettlement,
  CreatePayment,
  CreateReceipt,
  CreateRevenue,
  CreateRevenueSettlement,
  CreateTransfer,
  CursorPage,
  FinancialResource,
  Page,
  RevenuePosition,
  VoidExpenseSettlement,
  VoidRevenueSettlement,
} from "@lastro/contracts";
import type { Hono } from "hono";
import type { RouteDeps } from "./shared";

export function register(app: Hono, deps: RouteDeps) {
  const {
    opts,
    v1Context,
    v1Failure,
    v1Unauthorized,
    sessionIdentity,
    resource,
    transferResource,
  } = deps;
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
        occurredAt: input.data.occurredAt
          ? new Date(input.data.occurredAt)
          : undefined,
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
}
