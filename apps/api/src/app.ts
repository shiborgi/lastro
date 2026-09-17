/**
 * The HTTP/JSON surface, composed from one route module per concern.
 *
 * Nothing here decides a financial outcome. Every handler resolves an
 * `ExecutionContext` and calls an application command; the rules live in
 * `packages/domain` and the SQL in `packages/db`.
 */
import { Hono } from "hono";
import * as catalog from "./routes/catalog";
import * as financial from "./routes/financial";
import * as health from "./routes/health";
import * as insights from "./routes/insights";
import { type ApiOptions, createRouteDeps } from "./routes/shared";
import * as statements from "./routes/statements";

export type { SessionProvider } from "./routes/shared";
export type { HealthBody } from "./routes/health";

export function createApi(opts: ApiOptions) {
  const app = new Hono();
  const deps = createRouteDeps(opts);

  if (opts.sessions) {
    const handler = opts.sessions.handler;
    app.all("/api/auth/*", (c) => handler(c.req.raw));
  }

  financial.register(app, deps);

  /*
   * The groups below reach for `application` directly rather than through
   * `opts`, so they only register when there is one to reach for. Without a
   * repository the API still answers `/health` and the auth routes, which is
   * what a probe and a sign-in need.
   */
  if (opts.application) {
    catalog.register(app, deps);
    insights.register(app, deps);
    statements.register(app, deps);
  }

  health.register(app, deps);
  return app;
}
