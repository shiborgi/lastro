/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "@lastro/application";
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
    actorPrincipal: "wave14-user",
    delegatedOperator: "wave14-user",
    bookId,
    source: "API" as const,
    correlationId: randomUUID(),
    action,
    resourceType: "expense",
    payload: {},
  };
}

describe("WAVE-1.4 API and MCP read parity", () => {
  test("API and official MCP client return equal normalized position and pagination", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const application = createApplication(repositories);
    const auth = createAuthService(repositories.auth);
    const userId = `wave14-user-${randomUUID()}`;
    await repositories.createUser({
      id: userId,
      email: `${userId}@example.test`,
      name: "Wave 1.4",
    });
    const book = await repositories.createBook("W1.4 Book");
    const otherBook = await repositories.createBook("W1.4 Other Book");
    await repositories.addBookMember({
      bookId: book.id,
      userId,
      role: "OWNER",
    });
    await repositories.addBookMember({
      bookId: otherBook.id,
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
      principal: "agent:wave14",
      delegatedOperator: userId,
      secret: "agent-secret",
    });
    const agentBearer = `Bearer ${agent.credential.id}.${agent.secret}`;

    try {
      const expenses = [];
      for (let i = 0; i < 5; i += 1) {
        const expense = await application.createExpense({
          context: {
            actorId: userId,
            bookId: book.id,
            role: "OWNER",
            source: "API",
            correlationId: randomUUID(),
          },
          accountId: account.id,
          partyId: party.id,
          expenseCategoryId: category.id,
          amountMinor: BigInt(100 + i),
          currency: "USD",
        });
        expenses.push(expense);
      }

      const context = {
        actorId: userId,
        bookId: book.id,
        role: "OWNER" as const,
        source: "API" as const,
        correlationId: randomUUID(),
      };

      const apiPage = await application.listExpensesPage({
        context,
        limit: 2,
      });
      expect(apiPage.items).toHaveLength(2);
      expect(apiPage.nextCursor).not.toBeNull();

      const apiSecond = await application.listExpensesPage({
        context,
        cursor: apiPage.nextCursor ?? undefined,
        limit: 2,
      });
      expect(apiSecond.items).toHaveLength(2);
      const apiIds = apiPage.items
        .map((item) => String(item.id))
        .concat(apiSecond.items.map((item) => String(item.id)));
      expect(new Set(apiIds).size).toBe(4);

      const client = new Client({ name: "lastro-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: {
          headers: { authorization: agentBearer, "x-book-id": book.id },
        },
      });
      await client.connect(transport);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name).sort();
      expect(toolNames).toEqual([
        "get_book_position",
        "list_books",
        "list_expense_settlements",
        "list_expenses",
        "list_payments",
      ]);
      expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
        true,
      );

      const mcpPage = await client.callTool({
        name: "list_expenses",
        arguments: { bookId: book.id, limit: 2 },
      });
      expect(mcpPage.isError).toBeUndefined();
      const mcpContent = mcpPage.content as Array<{ text: string }>;
      const mcpBody = JSON.parse(mcpContent[0].text);
      expect(mcpBody.items).toHaveLength(2);
      expect(mcpBody.nextCursor).not.toBeNull();

      const mcpSecond = await client.callTool({
        name: "list_expenses",
        arguments: {
          bookId: book.id,
          limit: 2,
          cursor: mcpBody.nextCursor,
        },
      });
      const mcpSecondContent = mcpSecond.content as Array<{ text: string }>;
      const mcpSecondBody = JSON.parse(mcpSecondContent[0].text);
      const mcpIds = mcpBody.items
        .map((item: { id: string }) => item.id)
        .concat(mcpSecondBody.items.map((item: { id: string }) => item.id));
      expect(new Set(mcpIds).size).toBe(4);
      expect(mcpIds.sort()).toEqual(apiIds.sort());

      const position = await client.callTool({
        name: "get_book_position",
        arguments: { bookId: book.id, limit: 10 },
      });
      expect(position.isError).toBeUndefined();
      const positionContent = position.content as Array<{ text: string }>;
      const positionBody = JSON.parse(positionContent[0].text);
      expect(positionBody.totals).toHaveLength(1);
      expect(positionBody.totals[0].currency).toBe("USD");
      expect(positionBody.totals[0].count).toBe(5);

      const apiPosition = await application.getBookPosition({
        context,
        limit: 10,
      });
      expect(apiPosition.totals[0].count).toBe(5);
      expect(apiPosition.totals[0].outstandingMinor).toBe(
        BigInt(positionBody.totals[0].outstandingMinor),
      );

      const foreign = await client.callTool({
        name: "list_expenses",
        arguments: { bookId: otherBook.id, limit: 2 },
      });
      expect(foreign.isError).toBe(true);

      await client.close();
      await transport.close();
    } finally {
      await closeDb(db);
    }
  });

  test("read-only MCP suite creates no financial records", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const application = createApplication(repositories);
    const auth = createAuthService(repositories.auth);
    const userId = `wave14-ro-${randomUUID()}`;
    await repositories.createUser({
      id: userId,
      email: `${userId}@example.test`,
      name: "Wave 1.4 RO",
    });
    const book = await repositories.createBook("W1.4 RO Book");
    await repositories.addBookMember({
      bookId: book.id,
      userId,
      role: "VIEWER",
    });
    const agent = await auth.issueAgentCredential({
      context: {
        actorId: userId,
        bookId: book.id,
        role: "OWNER",
        source: "API",
        correlationId: randomUUID(),
      },
      bookId: book.id,
      principal: "agent:wave14-ro",
      delegatedOperator: userId,
      secret: "agent-secret",
    });
    const agentBearer = `Bearer ${agent.credential.id}.${agent.secret}`;

    try {
      const before = await application.listExpenses({
        actorId: userId,
        bookId: book.id,
        role: "VIEWER",
        source: "API",
        correlationId: randomUUID(),
      });
      expect(before).toHaveLength(0);

      const client = new Client({ name: "lastro-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: {
          headers: { authorization: agentBearer, "x-book-id": book.id },
        },
      });
      await client.connect(transport);
      await client.listTools();
      await client.callTool({
        name: "list_expenses",
        arguments: { bookId: book.id, limit: 10 },
      });
      await client.callTool({
        name: "list_payments",
        arguments: { bookId: book.id, limit: 10 },
      });
      await client.callTool({
        name: "list_expense_settlements",
        arguments: { bookId: book.id, limit: 10 },
      });
      await client.callTool({
        name: "get_book_position",
        arguments: { bookId: book.id, limit: 10 },
      });
      await client.close();
      await transport.close();

      const after = await application.listExpenses({
        actorId: userId,
        bookId: book.id,
        role: "VIEWER",
        source: "API",
        correlationId: randomUUID(),
      });
      expect(after).toHaveLength(0);
      expect(await repositories.listPayments(book.id)).toHaveLength(0);
      expect(await repositories.listExpenseSettlements(book.id)).toHaveLength(
        0,
      );
    } finally {
      await closeDb(db);
    }
  });
});
