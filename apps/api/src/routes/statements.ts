/**
 * The review bench: the descriptors still waiting to be mapped, the staged
 * rows behind them, and promotion.
 *
 * Nothing here infers an economic fact. A row becomes an expense only through
 * the explicit post call, and only once its descriptor names a party and a
 * category (ADR 8).
 */
import {
  AccountMovementResource,
  CardMovementResource,
  PendingAccountDescriptorResource,
  PendingCardDescriptorResource,
  PostMovementBody,
  PostedMovement,
  movementResource,
} from "@lastro/contracts";
import type { MovementStatus } from "@lastro/domain";
import type { Hono } from "hono";
import type { RouteDeps } from "./shared";

export function register(app: Hono, deps: RouteDeps) {
  const { opts, application, v1Context, v1Failure, v1Unauthorized } = deps;
  /*
   * The two review queues. Split because the two statement kinds ask
   * different questions: the card side waits on a party and a category, the
   * account side also on a method — and a declared transfer waits on the
   * account at the other end instead of on a party it will never have.
   */
  app.get("/v1/books/:bookId/card-descriptors/pending", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    try {
      const items = await application.listPendingCardDescriptors(context);
      return c.json({
        items: items.map((item) =>
          PendingCardDescriptorResource.parse({
            ...item,
            total: item.total.toString(),
            firstSeen: item.firstSeen?.toISOString() ?? null,
            lastSeen: item.lastSeen?.toISOString() ?? null,
          }),
        ),
      });
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.get("/v1/books/:bookId/account-descriptors/pending", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    try {
      const items = await application.listPendingAccountDescriptors(context);
      return c.json({
        items: items.map((item) =>
          PendingAccountDescriptorResource.parse({
            ...item,
            total: item.total.toString(),
            firstSeen: item.firstSeen?.toISOString() ?? null,
            lastSeen: item.lastSeen?.toISOString() ?? null,
          }),
        ),
      });
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  /**
   * The staged rows themselves, so the review bench can show the movements a
   * descriptor stands for and not only the count.
   */
  app.get("/v1/books/:bookId/movements/:kind", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const kind = c.req.param("kind");
    if (kind !== "card" && kind !== "account") {
      return v1Failure(c, new Error("kind must be card or account"));
    }
    const raw = c.req.query("status");
    // Narrowed here rather than passed through: an unknown status is a
    // filter nobody asked for, and dropping it shows every row instead.
    const status: MovementStatus | undefined =
      raw === "PENDING" || raw === "POSTED" || raw === "IGNORED"
        ? raw
        : undefined;
    try {
      const query = { context, status };
      const items =
        kind === "card"
          ? (await application.listCardMovements(query)).map((item) =>
              CardMovementResource.parse(movementResource(item)),
            )
          : (await application.listAccountMovements(query)).map((item) =>
              AccountMovementResource.parse(movementResource(item)),
            );
      return c.json({ items });
    } catch (error) {
      return v1Failure(c, error);
    }
  });

  app.post("/v1/books/:bookId/movements/:kind/:id/post", async (c) => {
    const context = await v1Context(c);
    if (!context || !opts.application) return v1Unauthorized(c);
    const body = PostMovementBody.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return v1Failure(c, body.error);
    const kind = c.req.param("kind");
    if (kind !== "card" && kind !== "account") {
      return v1Failure(c, new Error("kind must be card or account"));
    }
    try {
      const posted = await application.postMovement({
        context,
        kind,
        id: c.req.param("id"),
        referenceMonth: new Date(body.data.referenceMonth),
      });
      return c.json(
        PostedMovement.parse({ ...posted, amount: posted.amount.toString() }),
        201,
      );
    } catch (error) {
      return v1Failure(c, error);
    }
  });
}
