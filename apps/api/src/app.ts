import type { Application } from "@lastro/application";
import { type AuthService, parseBearerCredential } from "@lastro/auth";
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

  async function contextFor(c: Context) {
    if (!opts.auth) return null;
    const bookId = c.req.header("x-book-id") ?? c.req.query("bookId");
    const token = parseBearerCredential(c.req.header("authorization") ?? null);
    if (!bookId || !token) return null;
    return opts.auth.authenticateSession({
      sessionId: token.credentialId,
      secret: token.secret,
      bookId,
      source: "API",
      correlationId: c.req.header("x-correlation-id") ?? crypto.randomUUID(),
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
