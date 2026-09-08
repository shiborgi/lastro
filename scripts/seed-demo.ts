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
  const _account =
    accounts[0] ??
    (await application.createAccount({
      context: ctx,
      key: "conta-demo",
      name: "Conta demo",
      type: "CHECKING",
    }));
  const parties = await application.listParties(ctx);
  const party =
    parties[0] ??
    (await application.createParty({
      context: ctx,
      key: "fornecedor-demo",
      name: "Fornecedor demo",
      type: "VENDOR",
    }));
  const categories = await application.listCategories(ctx, "EXPENSE");
  const category =
    categories[0] ??
    (await application.createCategory({
      context: ctx,
      kind: "EXPENSE",
      name: "Operacional",
    }));

  await application
    .createExpense({
      context: { ...ctx, idempotencyKey: "demo-seed-1" },
      key: "demo-seed-1",
      referenceMonth: new Date("2026-09-01T00:00:00Z"),
      partyId: party.id,
      categoryId: category.id,
      amount: 12500n,
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
