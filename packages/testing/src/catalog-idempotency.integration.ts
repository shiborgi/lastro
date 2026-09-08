/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "@lastro/application";
import { closeDb, createDb, createRepositories } from "@lastro/db";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

const context = (bookId: string, idempotencyKey?: string) => ({
  actorId: "catalog-idem-user",
  bookId,
  role: "OWNER" as const,
  source: "MCP" as const,
  correlationId: randomUUID(),
  idempotencyKey,
});

/*
 * The MCP tools require an idempotency key on every catalog write. A create
 * that accepts the key and ignores it promises a guarantee it does not
 * provide: a retried call after a dropped connection silently duplicates the
 * record. Categories are the sharpest case — they carry no unique constraint,
 * so nothing else would catch the duplicate.
 */
describe("catalog idempotency", () => {
  test("a repeated key returns the original record instead of creating a second", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const application = createApplication(repositories);

    try {
      const user = await repositories.createUser({
        id: `catalog-idem-${randomUUID()}`,
        email: `catalog-idem-${randomUUID()}@example.test`,
        name: "Catalog Idempotency",
      });
      const book = await repositories.createBook("Catalog Idempotency");
      await repositories.addBookMember({
        bookId: book.id,
        userId: user.id,
        role: "OWNER",
      });

      const asUser = (key?: string) => ({
        ...context(book.id, key),
        actorId: user.id,
      });

      for (const [label, create] of [
        [
          "category",
          (key: string) =>
            application.createCategory({
              context: asUser(key),
              name: "Utilities",
              kind: "EXPENSE" as const,
            }),
        ],
        [
          "institution",
          (key: string) =>
            application.createInstitution({
              context: asUser(key),
              key: `bank-${key}`,
              name: "Acme Bank",
            }),
        ],
        [
          "party",
          (key: string) =>
            application.createParty({
              context: asUser(key),
              key: `party-${key}`,
              name: "Power Co",
              type: "COMPANY",
            }),
        ],
        [
          "account",
          (key: string) =>
            application.createAccount({
              context: asUser(key),
              key: `account-${key}`,
              name: "Checking",
              type: "CHECKING",
            }),
        ],
      ] as const) {
        const idempotencyKey = `${label}-${randomUUID()}`;
        const first = await create(idempotencyKey);
        const second = await create(idempotencyKey);
        expect(`${label}:${second.id}`).toBe(`${label}:${first.id}`);
      }

      // Without a key each call is a distinct request and must create anew.
      const a = await application.createCategory({
        context: asUser(),
        name: "Unkeyed",
        kind: "EXPENSE",
      });
      const b = await application.createCategory({
        context: asUser(),
        name: "Unkeyed",
        kind: "EXPENSE",
      });
      expect(b.id).not.toBe(a.id);

      // Reusing a key for a different operation is a caller error, not a
      // silent replay of the wrong resource type.
      const shared = `shared-${randomUUID()}`;
      await application.createCategory({
        context: asUser(shared),
        name: "First use",
        kind: "EXPENSE",
      });
      await expect(
        application.createParty({
          context: asUser(shared),
          key: `party-${shared}`,
          name: "Second use",
          type: "COMPANY",
        }),
      ).rejects.toThrow(/another operation/);
    } finally {
      await closeDb(db);
    }
  });
});
