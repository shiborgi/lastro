/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test";
import { createEnvelope } from "@lastro/core";
import { type Db, auditEvents, idempotencyRecords } from "@lastro/core/db";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  defineOperation,
} from "@lastro/kernel";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
afterAll(() => closeDb(db));

const shape = { input: z.object({}), output: z.object({}) };
const write = defineOperation({
  ...shape,
  id: "probe.write",
  access: "write",
  http: { method: "POST", path: "/probe" },
  mcp: { name: "probe_write", description: "Write a probe." },
});
const otherWrite = defineOperation({
  ...shape,
  id: "probe.rewrite",
  access: "write",
  http: { method: "PATCH", path: "/probe" },
  mcp: { name: "probe_rewrite", description: "Rewrite a probe." },
});

const entry = { action: "probe.written", resourceType: "probe" };

async function stored(bookId: string) {
  const id = Number(bookId);
  return {
    audits: await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.bookId, id)),
    keys: await db
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.bookId, id)),
  };
}

describe("the write envelope on PostgreSQL", () => {
  test("a write commits its audit event and idempotency record together", async () => {
    const { book, as, core } = await seedBook(db, ["EDITOR"]);
    const envelope = createEnvelope(core);

    const result = await envelope.run(
      write,
      as("EDITOR", { idempotencyKey: "k1" }),
      async (scope) => {
        scope.audit({ ...entry, resourceId: "9", payload: { amount: "150" } });
        return { id: "9", amount: "150", note: null };
      },
    );

    expect(result).toEqual({ id: "9", amount: "150", note: null });
    const { audits, keys } = await stored(book.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      operation: "probe.write",
      action: "probe.written",
      resourceId: "9",
      actorType: "USER",
      payload: { amount: "150" },
    });
    expect(keys.map((row) => [row.key, row.operation])).toEqual([
      ["k1", "probe.write"],
    ]);
  });

  test("a replayed key returns the stored result and writes nothing", async () => {
    const { book, as, core } = await seedBook(db, ["EDITOR"]);
    const envelope = createEnvelope(core);
    const context = as("EDITOR", { idempotencyKey: "k1" });
    let runs = 0;
    const work = async (scope: { audit(e: typeof entry): void }) => {
      runs += 1;
      scope.audit(entry);
      return { id: String(runs), items: [{ amount: "1" }], voidedAt: null };
    };

    const first = await envelope.run(write, context, work);
    const second = await envelope.run(write, context, work);

    expect(second).toEqual(first);
    expect(runs).toBe(1);
    expect((await stored(book.id)).audits).toHaveLength(1);
  });

  test("two concurrent calls with one key run the work once", async () => {
    const { book, as, core } = await seedBook(db, ["EDITOR"]);
    const envelope = createEnvelope(core);
    const context = as("EDITOR", { idempotencyKey: "race" });
    let runs = 0;
    const work = async (scope: { audit(e: typeof entry): void }) => {
      runs += 1;
      await Bun.sleep(50);
      scope.audit(entry);
      return { run: runs };
    };

    const results = await Promise.all([
      envelope.run(write, context, work),
      envelope.run(write, context, work),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(runs).toBe(1);
    expect((await stored(book.id)).audits).toHaveLength(1);
  });

  test("a key used for another operation is a conflict", async () => {
    const { as, core } = await seedBook(db, ["EDITOR"]);
    const envelope = createEnvelope(core);
    const context = as("EDITOR", { idempotencyKey: "k1" });
    await envelope.run(write, context, async (scope) => scope.audit(entry));
    await expect(
      envelope.run(otherWrite, context, async (scope) => scope.audit(entry)),
    ).rejects.toThrow(ConflictError);
  });

  test("a failure inside the work rolls back the module's rows, the audit and the key", async () => {
    const { book, as, core } = await seedBook(db, ["EDITOR"]);
    const envelope = createEnvelope(core);

    await expect(
      envelope.run(
        write,
        as("EDITOR", { idempotencyKey: "k1" }),
        async (scope) => {
          // The module's own write, on the envelope's transaction.
          await (scope.handle as Db).insert(auditEvents).values({
            actorType: "SYSTEM",
            actorPrincipal: "probe",
            delegatedOperator: "probe",
            bookId: Number(book.id),
            source: "WORKER",
            correlationId: "c",
            operation: "probe.write",
            action: "probe.row",
            resourceType: "probe",
            payload: {},
          });
          scope.audit(entry);
          throw new Error("refused");
        },
      ),
    ).rejects.toThrow("refused");

    expect(await stored(book.id)).toEqual({ audits: [], keys: [] });
  });

  test("a member of another Book is refused and nothing is written", async () => {
    const mine = await seedBook(db, ["OWNER"]);
    const theirs = await seedBook(db, ["OWNER"]);
    const envelope = createEnvelope(mine.core);
    let ran = false;

    await expect(
      envelope.run(
        write,
        mine.as("OWNER", { bookId: theirs.book.id }),
        async () => {
          ran = true;
        },
      ),
    ).rejects.toThrow(UnauthorizedError);

    expect(ran).toBe(false);
    expect((await stored(theirs.book.id)).audits).toEqual([]);
  });

  test("a viewer is refused every write, whatever role the context claims", async () => {
    const { book, as, core } = await seedBook(db, ["VIEWER"]);
    const envelope = createEnvelope(core);
    for (const role of ["VIEWER", "OWNER"] as const) {
      await expect(
        envelope.run(write, { ...as("VIEWER"), role }, async (scope) =>
          scope.audit(entry),
        ),
      ).rejects.toThrow(ForbiddenError);
    }
    expect((await stored(book.id)).audits).toEqual([]);
  });
});
