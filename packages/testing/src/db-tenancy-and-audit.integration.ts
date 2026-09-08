/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "@lastro/application";
import { createAuthService } from "@lastro/auth";
import { closeDb, createDb, createRepositories } from "@lastro/db";
import { expectPgError } from "./compose";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

const context = (
  bookId: string,
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" = "OWNER",
) => ({
  actorId: "wave12-user",
  bookId,
  role,
  source: "API" as const,
  correlationId: randomUUID(),
});

describe("Book tenancy and audit invariants", () => {
  test("isolates Books, enforces composite relationships, conflicts on deletes, and audits MCP writes", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const application = createApplication(repositories);
    const auth = createAuthService(repositories.auth);
    const userId = `wave12-user-${randomUUID()}`;
    const user = await repositories.createUser({
      id: userId,
      email: `${userId}@example.test`,
      name: "Wave 1.2",
    });
    const bookA = await repositories.createBook("Book A");
    const bookB = await repositories.createBook("Book B");
    await repositories.addBookMember({
      bookId: bookA.id,
      userId: user.id,
      role: "OWNER",
    });
    await repositories.addBookMember({
      bookId: bookB.id,
      userId: user.id,
      role: "OWNER",
    });

    try {
      const userContext = (
        bookId: string,
        role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" = "OWNER",
      ) => ({ ...context(bookId, role), actorId: userId });
      expect(await application.listBooks(userContext(bookA.id))).toEqual([
        bookA,
      ]);
      expect(await application.listBooks(userContext(bookB.id))).toEqual([
        bookB,
      ]);
      const accountA = await application.createAccount({
        context: context(bookA.id),
        key: "account-a",
        name: "A checking",
        type: "CHECKING",
      });
      const accountB = await application.createAccount({
        context: context(bookB.id),
        key: "account-b",
        name: "B checking",
        type: "CHECKING",
      });
      const partyA = await application.createParty({
        context: context(bookA.id),
        key: "party-a",
        name: "A vendor",
        type: "VENDOR",
      });
      const partyB = await application.createParty({
        context: context(bookB.id),
        key: "party-b",
        name: "B vendor",
        type: "VENDOR",
      });
      const categoryA = await application.createCategory({
        context: context(bookA.id),
        kind: "EXPENSE",
        name: "A supplies",
      });

      expect(
        (await application.listAccounts(context(bookA.id))).map(
          (row) => row.bookId,
        ),
      ).toEqual([bookA.id]);
      expect(
        (await application.listAccounts(context(bookB.id))).map(
          (row) => row.bookId,
        ),
      ).toEqual([bookB.id]);

      await expectPgError(
        application.createExpense({
          context: context(bookA.id),
          key: "exp-bad",
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          partyId: partyB.id,
          categoryId: categoryA.id,
        }),
        "23503",
      );
      expect(await application.listExpenses(context(bookA.id))).toHaveLength(0);

      const expense = await application.createExpense({
        context: context(bookA.id),
        key: "exp-a",
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        partyId: partyA.id,
        categoryId: categoryA.id,
      });
      expect(expense.bookId).toBe(bookA.id);

      /*
       * The account needs a record pointing at it before deleting it can
       * conflict — the expense only references the party and the category.
       * Without this, the loop below asserted a conflict its own setup never
       * created.
       */
      await application.createPayment({
        context: context(bookA.id),
        accountId: accountA.id,
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        currency: "USD",
        dueAt: new Date("2026-10-10T00:00:00Z"),
      });

      for (const remove of [
        () =>
          application.deleteAccount({
            context: context(bookA.id),
            id: accountA.id,
          }),
        () =>
          application.deleteParty({
            context: context(bookA.id),
            id: partyA.id,
          }),
        () =>
          application.deleteCategory({
            context: context(bookA.id),
            id: categoryA.id,
          }),
      ]) {
        await expect(remove()).rejects.toMatchObject({ code: "CONFLICT" });
      }
      expect(await application.listExpenses(context(bookA.id))).toHaveLength(1);
      expect(await application.listAccounts(context(bookA.id))).toHaveLength(1);

      const issued = await auth.issueAgentCredential({
        context: context(bookA.id),
        bookId: bookA.id,
        principal: "agent:wave12",
        delegatedOperator: userId,
        secret: "secret",
      });
      const agent = await auth.authenticateAgent({
        credentialId: issued.credential.id,
        secret: issued.secret,
        bookId: bookA.id,
      });
      expect(agent).not.toBeNull();
      await application.createExpense({
        context: { ...agent?.context, correlationId: "wave12-mcp-correlation" },
        key: "exp-agent",
        referenceMonth: new Date("2026-09-01T00:00:00Z"),
        partyId: partyA.id,
        categoryId: categoryA.id,
      });
      const events = await repositories.listAuditEvents(
        "wave12-mcp-correlation",
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorType: "ASSISTANT",
        actorPrincipal: "agent:wave12",
        delegatedOperator: userId,
        bookId: Number(bookA.id),
        source: "MCP",
      });
      expect(await application.listExpenses(context(bookA.id))).toHaveLength(2);
      expect(
        (await application.listExpenses(context(bookB.id))).map(
          (row) => row.bookId,
        ),
      ).toEqual([]);
      expect(accountB.bookId).toBe(bookB.id);
    } finally {
      await closeDb(db);
    }
  });
});
