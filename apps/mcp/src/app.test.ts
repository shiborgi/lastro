/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApi } from "@lastro/api/src/app";
import { createApplication } from "@lastro/application";
import { createAuthService } from "@lastro/auth";
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
    const auth = createAuthService({
      createAgentCredential: async (credential) => credential,
      getAgentCredential: async () => null,
      revokeAgentCredential: async () => {},
      getMembership: async () => "VIEWER",
    });
    // Stands in for a signed-in Better Auth session on the HTTP side.
    const sessions = {
      handler: async () => new Response(null, { status: 404 }),
      api: { getSession: async () => ({ user: { id: "user-1" } }) },
    };
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
    const names = tools.tools.map((tool) => tool.name);

    // An agent must be able to build a Book from nothing: without full catalog
    // CRUD it can only reference ids somebody else created for it.
    for (const entity of ["institution", "account", "party", "category"]) {
      const plural =
        entity === "category"
          ? "categories"
          : entity === "party"
            ? "parties"
            : `${entity}s`;
      expect(names).toContain(`list_${plural}`);
      expect(names).toContain(`create_${entity}`);
      expect(names).toContain(`update_${entity}`);
      expect(names).toContain(`delete_${entity}`);
    }
    // Every surface the HTTP API exposes must be reachable over MCP too.
    expect(names).toContain("list_transfers");
    expect(names).toContain("get_cash_flow");

    const readTools = tools.tools.filter(
      (tool) => tool.name.startsWith("list_") || tool.name.startsWith("get_"),
    );
    expect(readTools.length).toBeGreaterThan(0);
    expect(readTools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
      true,
    );

    const destructive = tools.tools.filter(
      (tool) =>
        tool.name.startsWith("delete_") || tool.name.startsWith("void_"),
    );
    expect(destructive.every((tool) => tool.annotations?.destructiveHint)).toBe(
      true,
    );
    // Destructive tools must refuse to act until explicitly confirmed.
    const unconfirmed = await client.callTool({
      name: "delete_account",
      arguments: { bookId: "1", idempotencyKey: "k1", id: "1" },
    });
    expect(
      (unconfirmed.structuredContent as { confirmationRequired?: boolean })
        ?.confirmationRequired,
    ).toBe(true);
    const response = await client.callTool({
      name: "list_expenses",
      arguments: { bookId: "1", limit: 10 },
    });
    expect(response.isError).toBeUndefined();
    expect(JSON.stringify(response.content)).toContain(
      '{\\"items\\":[],\\"nextCursor\\":null}',
    );
    const api = createApi({
      ping: async () => true,
      auth,
      application,
      sessions,
    });
    const apiResponse = await api.request("/v1/books/1/expenses?limit=10");
    expect(await apiResponse.json()).toEqual({ items: [], nextCursor: null });
    expect(writes).toBe(0);

    await client.close();
    await server.close();
    expect(server.isConnected()).toBe(false);
  });
});
