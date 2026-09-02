import { Hono } from "hono";

export type HealthBody = {
  status: "ok" | "degraded";
  database: { status: "up" | "down" };
};

export function createApi(opts: { ping: () => Promise<boolean> }) {
  const app = new Hono();
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
