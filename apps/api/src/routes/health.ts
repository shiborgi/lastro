/**
 * Liveness, including whether the database answers. Deliberately outside the
 * Book scope and outside authentication — a probe has no session.
 */
import type { Hono } from "hono";
import type { RouteDeps } from "./shared";

export type HealthBody = {
  status: "ok" | "degraded";
  database: { status: "up" | "down" };
};

export function register(app: Hono, deps: RouteDeps) {
  const { opts } = deps;
  app.get("/health", async (c) => {
    const up = await opts.ping();
    const body: HealthBody = {
      status: up ? "ok" : "degraded",
      database: { status: up ? "up" : "down" },
    };
    return c.json(body, up ? 200 : 503);
  });
}
