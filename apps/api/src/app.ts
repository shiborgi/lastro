/**
 * The HTTP adapter (ADR 12): every operation of the composed host, published
 * from its descriptor. No route here names a business operation.
 *
 * A Book operation lives at `/v1/books/:bookId<path>`, a user operation at
 * `/v1<path>`. The input is the query string for a GET and the JSON body
 * otherwise, with the path parameters merged in. The idempotency key is the
 * `Idempotency-Key` header. Every failure is `toFailure`'s answer.
 */
import { parseBearerCredential } from "@lastro/core";
import type { LastroHost } from "@lastro/host";
import {
  type OperationDescriptor,
  UnauthorizedError,
  toFailure,
} from "@lastro/kernel";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type HttpOptions = {
  host: Pick<LastroHost, "operations" | "execute" | "modules">;
  ping: () => Promise<boolean>;
  /** The signed-in user of a request, from the session cookie; null for none. */
  sessionUser: (request: Request) => Promise<string | null>;
  /** Better Auth's own routes, mounted at `/api/auth/*` when given. */
  authHandler?: (request: Request) => Promise<Response>;
};

const unauthenticated = {
  error: { code: "UNAUTHORIZED", message: "authentication is required" },
};

export function routeOf(descriptor: OperationDescriptor): string {
  return descriptor.scope === "user"
    ? `/v1${descriptor.http.path}`
    : `/v1/books/:bookId${descriptor.http.path}`;
}

export function createHttp(options: HttpOptions) {
  const app = new Hono();
  const { identity } = options.host.modules.core;

  if (options.authHandler) {
    const handler = options.authHandler;
    app.all("/api/auth/*", (c) => handler(c.req.raw));
  }

  // Liveness: the process answers. No database check; use /health for readiness.
  app.get("/health/live", (c) => c.json({ status: "live" }));

  app.get("/health", async (c) => {
    const up = await options.ping().catch(() => false);
    return c.json(
      {
        status: up ? "ok" : "degraded",
        database: { status: up ? "up" : "down" },
      },
      up ? 200 : 503,
    );
  });

  /*
   * Two ways in, one context out: a person with a session, or an agent with
   * a `Bearer <credentialId>.<secret>` credential. Either way the role comes
   * from Book membership, resolved again by the envelope.
   */
  async function contextOf(c: Context, descriptor: OperationDescriptor) {
    const facts = {
      source: "API" as const,
      correlationId: c.req.header("x-correlation-id") ?? crypto.randomUUID(),
      idempotencyKey: c.req.header("idempotency-key") ?? undefined,
    };
    const userId = await options.sessionUser(c.req.raw);
    const token = parseBearerCredential(c.req.header("authorization") ?? null);
    if (descriptor.scope === "user") {
      if (userId) return identity.userContext({ userId, ...facts });
      if (!token) return null;
      const agent = await identity.authenticateAgent(token);
      return agent
        ? identity.userContext({
            userId: agent.credential.delegatedOperator,
            agentPrincipal: agent.credential.principal,
            ...facts,
          })
        : null;
    }
    const bookId = c.req.param("bookId") as string;
    if (userId) {
      // A signed-in person outside this Book gets core's one answer for "not yours" and "not there".
      const context = await identity.contextForUser({
        userId,
        bookId,
        ...facts,
      });
      if (!context) throw new UnauthorizedError();
      return context;
    }
    if (!token) return null;
    return (
      (await identity.authenticateAgent({ ...token, bookId, ...facts }))
        ?.context ?? null
    );
  }

  async function inputOf(c: Context, descriptor: OperationDescriptor) {
    const { bookId: _book, ...params } = c.req.param() as Record<
      string,
      string
    >;
    if (descriptor.http.method === "GET")
      return { ...c.req.query(), ...params };
    const body = await c.req.json().catch(() => ({}));
    return {
      ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
      ...params,
    };
  }

  for (const descriptor of options.host.operations) {
    const method = descriptor.http.method.toLowerCase() as
      | "get"
      | "post"
      | "patch"
      | "put"
      | "delete";
    app[method](routeOf(descriptor), async (c) => {
      try {
        const context = await contextOf(c, descriptor);
        if (!context) return c.json(unauthenticated, 401);
        const result = await options.host.execute(
          descriptor.id,
          context,
          await inputOf(c, descriptor),
        );
        return c.json(result as object, 200);
      } catch (error) {
        const failure = toFailure(error);
        return c.json(
          {
            error: {
              code: failure.code,
              message: failure.message,
              ...(failure.details ? { details: failure.details } : {}),
            },
          },
          failure.status as ContentfulStatusCode,
        );
      }
    });
  }

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "no such route" } }, 404),
  );
  return app;
}
