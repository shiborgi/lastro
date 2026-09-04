#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { createApplication } from "@lastro/application";
import { createAuthService } from "@lastro/auth";
import { closeDb, createDb, createRepositories } from "@lastro/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);
const repositories = createRepositories(db);
const application = createApplication(repositories);
const auth = createAuthService(repositories.auth);

const context = (bookId: string) => ({
  actorId: "demo-user",
  bookId,
  role: "OWNER" as const,
  source: "API" as const,
  correlationId: randomUUID(),
});

try {
  await repositories
    .createUser({
      id: "demo-user",
      email: "demo@example.test",
      name: "Demo",
    })
    .catch(() => null);

  const books = await repositories.listBooks("demo-user");
  const book = books[0] ?? (await repositories.createBook("Demo Book"));
  await repositories
    .addBookMember({ bookId: book.id, userId: "demo-user", role: "OWNER" })
    .catch(() => null);
  const ctx = context(book.id);

  const accounts = await application.listAccounts(ctx);
  const account =
    accounts[0] ??
    (await application.createAccount({
      context: ctx,
      name: "Conta demo",
      type: "CHECKING",
    }));
  const parties = await application.listParties(ctx);
  const party =
    parties[0] ??
    (await application.createParty({
      context: ctx,
      name: "Fornecedor demo",
      type: "VENDOR",
    }));
  const categories = await application.listExpenseCategories(ctx);
  const category =
    categories[0] ??
    (await application.createExpenseCategory({
      context: ctx,
      name: "Operacional",
    }));

  await application
    .createExpense({
      context: { ...ctx, idempotencyKey: "demo-seed-1" },
      accountId: account.id,
      partyId: party.id,
      expenseCategoryId: category.id,
      amountMinor: 12500n,
      currency: "BRL",
    })
    .catch(() => null);

  const secret = randomUUID().replaceAll("-", "");
  const { session } = await auth.createSession({
    userId: "demo-user",
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    secret,
  });

  console.log(`bookId=${book.id}`);
  console.log(`LASTRO_API_TOKEN=${session.id}.${secret}`);
} finally {
  await closeDb(db);
}
