/**
 * What every route group needs, built once and handed to each of them.
 *
 * The helpers here are the API's whole security and serialization seam: two
 * ways in resolving to one `ExecutionContext`, one failure mapper, and the
 * resource parsers that turn a domain record into the decimal-string shape the
 * wire carries. Route modules close over these rather than rebuilding them, so
 * a group cannot quietly authorize or serialize differently from its siblings.
 */
import type { Application } from "@lastro/application";
import { databaseRefusal } from "@lastro/application";
import { type AuthService, parseBearerCredential } from "@lastro/auth";
import {
  FinancialResource,
  TransferResource,
  normalizeResource,
} from "@lastro/contracts";
import { LastroError } from "@lastro/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

export type ApiOptions = {
  ping: () => Promise<boolean>;
  auth?: AuthService;
  application?: Application;
  sessions?: SessionProvider;
};

export type RouteDeps = ReturnType<typeof createRouteDeps>;

export function createRouteDeps(opts: ApiOptions) {
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
    /*
     * A rule the database enforced, in the words it was written with. The ORM
     * wraps those in "Failed query: insert into ...", which tells the operator
     * nothing — and the triggers in this schema exist precisely to say what is
     * wrong and what to do about it.
     */
    const refusal = databaseRefusal(error);
    if (refusal) {
      return c.json({ error: { code: "CONFLICT", message: refusal } }, 409);
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

  return {
    opts,
    /*
     * Non-null inside the groups that only register when it is present. The
     * composition root checks once; carrying the narrowed value here saves
     * every handler repeating the assertion.
     */
    application: opts.application as Application,
    v1Context,
    v1Failure,
    v1Unauthorized,
    sessionIdentity,
    resource,
    transferResource,
  };
}
