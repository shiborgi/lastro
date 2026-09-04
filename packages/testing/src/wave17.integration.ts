/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createAuthService } from "@lastro/auth";
import { closeDb, createDb, createRepositories } from "@lastro/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";
const mcpUrl = process.env.MCP_URL ?? "http://127.0.0.1:3457/mcp";

function audit(bookId: string, action: string) {
  return {
    actorType: "USER" as const,
    actorPrincipal: "wave17-user",
    delegatedOperator: "wave17-user",
    bookId,
    source: "API" as const,
    correlationId: randomUUID(),
    action,
    resourceType: "expense",
    payload: {},
  };
}

describe("WAVE-1.7 confirmed MCP writes and agent identity", () => {
  test("generic MCP client creates, confirms void, and correlates audit", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const auth = createAuthService(repositories.auth);
    const userId = `wave17-user-${randomUUID()}`;
    await repositories.createUser({
      id: userId,
      email: `${userId}@example.test`,
      name: "Wave 1.7",
    });
    const book = await repositories.createBook("W1.7 Book");
    await repositories.addBookMember({
      bookId: book.id,
      userId,
      role: "OWNER",
    });
    const account = await repositories.createAccount(
      { bookId: book.id, name: "Checking", type: "CHECKING" },
      audit(book.id, "account.created"),
    );
    const party = await repositories.createParty(
      { bookId: book.id, name: "Vendor", type: "VENDOR" },
      audit(book.id, "party.created"),
    );
    const category = await repositories.createExpenseCategory(
      { bookId: book.id, name: "Supplies" },
      audit(book.id, "expense_category.created"),
    );

    const agent = await auth.issueAgentCredential({
      context: {
        actorId: userId,
        bookId: book.id,
        role: "OWNER",
        source: "API",
        correlationId: randomUUID(),
      },
      bookId: book.id,
      principal: "agent:wave17",
      delegatedOperator: userId,
      secret: "agent-secret",
    });
    const agentBearer = `Bearer ${agent.credential.id}.${agent.secret}`;

    try {
      const correlationId = `wave17-${randomUUID()}`;
      const client = new Client({ name: "lastro-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: {
          headers: {
            authorization: agentBearer,
            "x-book-id": book.id,
            "x-correlation-id": correlationId,
          },
        },
      });
      await client.connect(transport);

      // AC-1.7.3.1: generic client obtains a server-derived value through a Lastro tool.
      const createResponse = await client.callTool({
        name: "create_expense",
        arguments: {
          bookId: book.id,
          idempotencyKey: `expense-${randomUUID()}`,
          accountId: account.id,
          partyId: party.id,
          expenseCategoryId: category.id,
          amountMinor: "100",
          currency: "USD",
        },
      });
      expect(createResponse.isError).toBeUndefined();
      const createContent = createResponse.content as Array<{ text: string }>;
      const created = JSON.parse(createContent[0].text);
      expect(created.expense.id).toBeTruthy();
      const expenseId = created.expense.id;

      // AC-1.7.3.3: void without confirmation makes no mutation.
      const voidWithout = await client.callTool({
        name: "void_expense_settlement",
        arguments: {
          bookId: book.id,
          idempotencyKey: `void-${randomUUID()}`,
          settlementId: "does-not-exist",
        },
      });
      expect(JSON.stringify(voidWithout.content)).toContain(
        "Confirmation required",
      );

      // AC-1.7.3.1: position reflects the created expense.
      const position = await client.callTool({
        name: "get_book_position",
        arguments: { bookId: book.id, limit: 10 },
      });
      expect(position.isError).toBeUndefined();
      const positionContent = position.content as Array<{ text: string }>;
      const positionBody = JSON.parse(positionContent[0].text);
      expect(
        positionBody.expenses.items.some(
          (item: { expense: { id: string } }) => item.expense.id === expenseId,
        ),
      ).toBe(true);

      // AC-1.7.3.4: audit correlates the agent principal, delegated operator, Book, and entity.
      const auditEvents = await repositories.listAuditEvents(correlationId);
      const expenseAudit = auditEvents.find(
        (event) => event.action === "expense.created",
      );
      expect(expenseAudit).toBeTruthy();
      expect(expenseAudit?.actorType).toBe("ASSISTANT");
      expect(expenseAudit?.actorPrincipal).toBe("agent:wave17");
      expect(expenseAudit?.delegatedOperator).toBe(userId);
      expect(String(expenseAudit?.bookId)).toBe(book.id);
      expect(expenseAudit?.resourceId).toBe(expenseId);

      await client.close();
    } finally {
      await closeDb(db);
    }
  });
});
