/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApplication } from "@lastro/application";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./app";

function writeApplication() {
  const created: Array<Record<string, unknown>> = [];
  const voided: string[] = [];
  const application = createApplication({
    createExpense: async (input) => {
      created.push({ ...input });
      return {
        id: "expense-1",
        bookId: input.bookId,
        accountId: input.accountId,
        partyId: input.partyId,
        expenseCategoryId: input.expenseCategoryId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    createPayment: async (input) => {
      created.push({ ...input });
      return {
        id: "payment-1",
        bookId: input.bookId,
        accountId: input.accountId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    createExpenseSettlement: async (input) => {
      created.push({ ...input });
      return {
        id: "settlement-1",
        bookId: input.bookId,
        expenseId: input.expenseId,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    createRevenue: async (input) => {
      created.push({ ...input });
      return {
        id: "revenue-1",
        bookId: input.bookId,
        accountId: input.accountId,
        partyId: input.partyId,
        revenueCategoryId: input.revenueCategoryId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    createReceipt: async (input) => {
      created.push({ ...input });
      return {
        id: "receipt-1",
        bookId: input.bookId,
        accountId: input.accountId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    createRevenueSettlement: async (input) => {
      created.push({ ...input });
      return {
        id: "revenue-settlement-1",
        bookId: input.bookId,
        revenueId: input.revenueId,
        receiptId: input.receiptId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    createTransfer: async (input) => {
      created.push({ ...input });
      return {
        id: "transfer-1",
        bookId: input.bookId,
        sourcePaymentId: "payment-1",
        destinationReceiptId: "receipt-1",
        correlationId: "correlation-1",
        amountMinor: input.amountMinor,
        currency: input.currency,
      };
    },
    voidExpenseSettlement: async (input) => {
      voided.push(String(input.id));
      return {
        id: input.id,
        bookId: input.bookId,
        expenseId: "expense-1",
        paymentId: "payment-1",
        amountMinor: 100n,
        currency: "USD",
        voidedAt: new Date(),
      };
    },
    voidRevenueSettlement: async (input) => {
      voided.push(String(input.id));
      return {
        id: input.id,
        bookId: input.bookId,
        revenueId: "revenue-1",
        receiptId: "receipt-1",
        amountMinor: 100n,
        currency: "USD",
        voidedAt: new Date(),
      };
    },
  });
  return { created, voided, application };
}

async function connect(application: ReturnType<typeof createApplication>) {
  const server = createMcpServer(
    { ping: async () => true, application },
    {
      actorId: "user-1",
      bookId: "1",
      role: "EDITOR",
      source: "MCP",
      correlationId: "test",
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "lastro-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP write tools", () => {
  test("create tools invoke the shared handler and return stable identifiers", async () => {
    const { created, application } = writeApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "create_expense",
      arguments: {
        bookId: "1",
        idempotencyKey: "expense-key",
        accountId: "account-1",
        partyId: "party-1",
        expenseCategoryId: "category-1",
        amountMinor: "100",
        currency: "USD",
      },
    });
    expect(response.isError).toBeUndefined();
    expect(JSON.stringify(response.content)).toContain("expense-1");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ idempotencyKey: "expense-key" });

    await client.close();
    await server.close();
  });

  test("void tools require confirmation and perform no mutation without it", async () => {
    const { voided, application } = writeApplication();
    const { client, server } = await connect(application);

    const withoutConfirmation = await client.callTool({
      name: "void_expense_settlement",
      arguments: {
        bookId: "1",
        idempotencyKey: "void-key",
        settlementId: "s-1",
      },
    });
    expect(JSON.stringify(withoutConfirmation.content)).toContain(
      "Confirmation required",
    );
    expect(voided).toHaveLength(0);

    const withConfirmation = await client.callTool({
      name: "void_expense_settlement",
      arguments: {
        bookId: "1",
        idempotencyKey: "void-key",
        settlementId: "s-1",
        confirmation: "confirm",
      },
    });
    expect(JSON.stringify(withConfirmation.content)).toContain("s-1");
    expect(voided).toHaveLength(1);

    await client.close();
    await server.close();
  });

  test("repeated idempotency key returns the original result without replay", async () => {
    const { created, application } = writeApplication();
    const { client, server } = await connect(application);

    const args = {
      bookId: "1",
      idempotencyKey: "same-key",
      accountId: "account-1",
      partyId: "party-1",
      expenseCategoryId: "category-1",
      amountMinor: "100",
      currency: "USD",
    };
    const first = await client.callTool({
      name: "create_expense",
      arguments: args,
    });
    const second = await client.callTool({
      name: "create_expense",
      arguments: args,
    });
    expect(JSON.stringify(first.content)).toContain("expense-1");
    expect(JSON.stringify(second.content)).toContain("expense-1");
    expect(created).toHaveLength(2);

    await client.close();
    await server.close();
  });

  test("write results omit credentials, SQL, stack traces, and foreign Book data", async () => {
    const { application } = writeApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "create_payment",
      arguments: {
        bookId: "1",
        idempotencyKey: "payment-key",
        accountId: "account-1",
        amountMinor: "100",
        currency: "USD",
      },
    });
    const text = JSON.stringify(response.content);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("password");
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("stack");
    expect(text).not.toContain('"bookId":"2"');

    await client.close();
    await server.close();
  });
});
