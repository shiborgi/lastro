#!/usr/bin/env bun
/*
 * A small demo Book for a local install: an owner, a bank account, a till,
 * a supplier, an expense and a product, all through the public operations,
 * plus an agent credential. Re-running reuses what exists.
 */
import { randomUUID } from "node:crypto";
import { closeDb, createDb, createHost } from "@lastro/host";
import type { ExecutionContext } from "@lastro/kernel";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl);
const host = createHost(db);
const { admin } = host.modules.core;

type Row = { id: string } & Record<string, unknown>;

try {
  const user =
    (await admin.getUserByEmail("demo@example.test")) ??
    (await admin.createUser({
      id: "demo-user",
      email: "demo@example.test",
      name: "Demo",
    }));
  const book = await admin.ensureBook({ key: "demo-book", name: "Demo Book" });
  await admin.setBookMember({
    bookId: book.id,
    userId: user.id,
    role: "OWNER",
  });

  const context = (key: string): ExecutionContext => ({
    actorId: user.id,
    bookId: book.id,
    role: "OWNER",
    source: "WORKER",
    correlationId: randomUUID(),
    // A fixed key per write makes every re-run a replay of the first.
    idempotencyKey: `seed-demo:${key}`,
  });
  // The key names the record, not the operation: two accounts are two writes.
  const write = async (id: string, input: Record<string, unknown>) =>
    (await host.execute(
      id,
      context(`${id}:${String(input.key ?? input.name)}`),
      input,
    )) as Row;

  const bank = await write("finance.createAccount", {
    key: "conta-demo",
    name: "Conta demo",
    type: "ACCOUNT",
  });
  await write("finance.createAccount", {
    key: "caixa",
    name: "Caixa",
    type: "CASH",
  });
  const supplier = await write("finance.createParty", {
    key: "fornecedor-demo",
    name: "Fornecedor demo",
    type: "COMPANY",
  });
  const costs = await write("finance.createFinancialCategory", {
    name: "Operacional",
    kind: "EXPENSE",
  });
  await write("finance.createFinancialCategory", {
    name: "Vendas",
    kind: "REVENUE",
  });
  await write("finance.createExpense", {
    key: "demo-expense-1",
    partyId: supplier.id,
    financialCategoryId: costs.id,
    amount: "12500",
    currency: "BRL",
    referenceMonth: "2026-11-01",
  });
  const drinks = await write("sales.createProductCategory", {
    key: "bebidas",
    name: "Bebidas",
  });
  await write("sales.createProduct", {
    key: "cerveja",
    name: "Cerveja",
    productCategoryId: drinks.id,
    costOverride: "450",
  });

  const issued = await admin.issueAgentCredential({
    bookId: book.id,
    principal: "agent:demo",
    delegatedOperator: user.id,
    issuedBy: "seed-demo",
  });
  console.log(`bookId=${book.id}`);
  console.log(`bank account ${bank.id}`);
  console.log(`MCP_BEARER_TOKEN=${issued.token}`);
} finally {
  await closeDb(db);
}
