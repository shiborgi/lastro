import type { Application } from "@lastro/application";
import { type AuthService, authenticateMcpRequest } from "@lastro/auth";
import { LastroError } from "@lastro/domain";
import { Hono } from "hono";
import type { Context } from "hono";

export function createMcp(opts: {
  ping: () => Promise<boolean>;
  auth?: AuthService;
  application?: Application;
}) {
  const app = new Hono();

  const unauthorized = (c: Context) =>
    c.json({ error: "UNAUTHORIZED_OR_NOT_FOUND" }, 404);

  const listBooks = async (c: Context) => {
    if (!opts.auth || !opts.application) return unauthorized(c);
    const requestedBookId = c.req.header("x-book-id") ?? c.req.query("bookId");
    const authenticated = await authenticateMcpRequest(
      c.req.raw,
      opts.auth,
      requestedBookId,
    );
    if (!authenticated) return unauthorized(c);
    const correlationId = c.req.header("x-correlation-id");
    const context = correlationId
      ? { ...authenticated.context, correlationId }
      : authenticated.context;
    const books = await opts.application.listBooks(context);
    return c.json({ books });
  };

  app.get("/tools/list_books", listBooks);
  app.get("/list_books", listBooks);

  const createExpense = async (c: Context) => {
    if (!opts.auth || !opts.application) return unauthorized(c);
    const requestedBookId = c.req.header("x-book-id");
    const authenticated = await authenticateMcpRequest(
      c.req.raw,
      opts.auth,
      requestedBookId,
    );
    if (!authenticated) return unauthorized(c);
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "INVALID_REQUEST" }, 400);
    }
    const input = body as Record<string, unknown>;
    if (
      input.bookId !== undefined &&
      String(input.bookId) !== authenticated.context.bookId
    ) {
      return unauthorized(c);
    }
    const correlationId = c.req.header("x-correlation-id");
    try {
      const expense = await opts.application.createExpense({
        context: correlationId
          ? { ...authenticated.context, correlationId }
          : authenticated.context,
        accountId: String(input.accountId ?? ""),
        partyId: String(input.partyId ?? ""),
        expenseCategoryId: String(input.expenseCategoryId ?? ""),
      });
      return c.json({ expense }, 201);
    } catch (error) {
      if (error instanceof LastroError) {
        return c.json({ error: error.code }, error.status as 400);
      }
      throw error;
    }
  };

  app.post("/tools/create_expense", createExpense);

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
