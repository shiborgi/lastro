/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApi } from "@lastro/api/src/app";
import { createApplication } from "@lastro/application";
import { type Session, createAuthService } from "@lastro/auth";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./app";

describe("MCP v2 read-only tools", () => {
  test("uses the SDK transport, exposes only reads, and shares the expense query", async () => {
    let writes = 0;
    const application = createApplication({
      listExpenses: async () => [],
      createExpense: async () => {
        writes += 1;
        throw new Error("writes must not be exposed");
      },
    });
    const sessions = new Map<string, Session>();
    const auth = createAuthService({
      createAgentCredential: async (credential) => credential,
      getAgentCredential: async () => null,
      revokeAgentCredential: async () => {},
      getMembership: async () => "VIEWER",
      createSession: async (session) => {
        sessions.set(session.id, session);
        return session;
      },
      getSession: async (id) => sessions.get(id) ?? null,
      revokeSession: async () => {},
    });
    const issuedSession = await auth.createSession({
      userId: "user-1",
      secret: "secret",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const server = createMcpServer(
      { ping: async () => true, application },
      {
        actorId: "user-1",
        bookId: "1",
        role: "VIEWER",
        source: "MCP",
        correlationId: "test",
      },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "lastro-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "get_book_position",
      "list_books",
      "list_expense_settlements",
      "list_expenses",
      "list_payments",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
      true,
    );
    const response = await client.callTool({
      name: "list_expenses",
      arguments: { bookId: "1", limit: 10 },
    });
    expect(response.isError).toBeUndefined();
    expect(JSON.stringify(response.content)).toContain(
      '{\\"items\\":[],\\"nextCursor\\":null}',
    );
    const api = createApi({ ping: async () => true, auth, application });
    const apiResponse = await api.request("/v1/books/1/expenses?limit=10", {
      headers: {
        authorization: `Bearer ${issuedSession.session.id}.${issuedSession.secret}`,
      },
    });
    expect(await apiResponse.json()).toEqual({ items: [], nextCursor: null });
    expect(writes).toBe(0);

    await client.close();
    await server.close();
    expect(server.isConnected()).toBe(false);
  });
});
