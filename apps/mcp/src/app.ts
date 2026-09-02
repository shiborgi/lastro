import { Hono } from "hono";

export function createMcp(opts: { ping: () => Promise<boolean> }) {
  const app = new Hono();
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
