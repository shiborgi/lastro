/**
 * The summary read over a Book: the gaps still waiting on a decision, the
 * daily cash series, and the totals by group.
 */
import { BookInsightsResource } from "@lastro/contracts";
import type { Hono } from "hono";
import type { RouteDeps } from "./shared";

export function register(app: Hono, deps: RouteDeps) {
  const { opts, application, v1Context, v1Failure, v1Unauthorized } = deps;
  /*
   * The review bench. One descriptor stands for every movement that shares
   * its wording, so this list is what the operator actually works through —
   * ordered by how much each decision resolves, with the institution's own
   * category carried alongside as evidence rather than as an answer.
   */
  app.get("/v1/books/:bookId/insights", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    try {
      const insights = await application.bookInsights(context);
      return c.json(
        BookInsightsResource.parse({
          gap: insights.gap,
          cash: insights.cash.map((entry) => ({
            source: entry.source,
            days: entry.days.map((day) => ({
              date: day.date.toISOString(),
              inflow: day.inflow.toString(),
              outflow: day.outflow.toString(),
            })),
          })),
          byGroup: insights.byGroup.map((row) => ({
            ...row,
            total: row.total.toString(),
          })),
        }),
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });
}
