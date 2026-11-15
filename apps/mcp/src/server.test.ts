/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { closeTestHost } from "@lastro/close/testing";
import type { CoreApi } from "@lastro/core";
import type { LastroHost } from "@lastro/host";
import type { ExecutionContext } from "@lastro/kernel";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, mcpModules, operationsOf } from "./server";

/* A real MCP client against the real modules over memory, as an agent sees them. */
async function agent(actorId = "editor") {
  const { host } = closeTestHost();
  const context: ExecutionContext = {
    actorId,
    bookId: "1",
    role: "VIEWER",
    source: "MCP",
    correlationId: "c",
    actorType: "ASSISTANT",
    agentPrincipal: "agent:example",
    delegatedOperator: actorId,
  };
  // One client per module's server, as an agent connects to each it uses.
  const clients = new Map<string, Client>();
  for (const moduleId of mcpModules(host)) {
    const server = createMcpServer(
      host as unknown as LastroHost,
      context,
      moduleId,
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    clients.set(moduleId, client);
  }
  const moduleOf = (name: string) =>
    host.operations.find((each) => each.mcp.name === name)?.id.split(".")[0] ??
    "core";
  const clientOf = (name: string) => clients.get(moduleOf(name)) as Client;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await clientOf(name).callTool({ name, arguments: args });
    return result as {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
      content: { text: string }[];
    };
  };
  return { host, clients, call };
}

describe("the MCP adapter", () => {
  test("each module's server lists its own operations, and together every one", async () => {
    const { host, clients } = await agent();
    const tools = [];
    for (const [moduleId, client] of clients) {
      const listed = (await client.listTools()).tools;
      expect(listed.map((tool) => tool.name).sort()).toEqual(
        operationsOf(host, moduleId)
          .map((operation) => operation.mcp.name)
          .sort(),
      );
      tools.push(...listed);
    }
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      host.operations.map((operation) => operation.mcp.name).sort(),
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const create = byName.get("create_account");
    expect(create?.inputSchema.required).toEqual(
      expect.arrayContaining(["key", "name", "type", "idempotencyKey"]),
    );
    expect(create?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(
      Object.keys(byName.get("list_accounts")?.inputSchema.properties ?? {}),
    ).not.toContain("idempotencyKey");
    expect(byName.get("undo_sale_movement")?.annotations?.destructiveHint).toBe(
      true,
    );
  });

  test("a write needs its idempotency key, and replays with it", async () => {
    const { call } = await agent();
    const missing = await call("create_institution", {
      key: "bank",
      name: "Bank",
    });
    expect(missing.isError).toBe(true);
    const input = { key: "bank", name: "Bank", idempotencyKey: "k1" };
    const first = await call("create_institution", input);
    expect(first.structuredContent).toMatchObject({ key: "bank" });
    expect((await call("create_institution", input)).structuredContent).toEqual(
      first.structuredContent,
    );
    expect((await call("list_institutions")).structuredContent).toMatchObject({
      items: [{ key: "bank" }],
    });
  });

  test("a destructive tool asks for confirmation before it runs", async () => {
    const { call } = await agent();
    const created = await call("create_institution", {
      key: "bank",
      name: "Bank",
      idempotencyKey: "k1",
    });
    const id = created.structuredContent.id;
    const asked = await call("delete_institution", {
      id,
      idempotencyKey: "k2",
    });
    expect(asked.structuredContent).toEqual({
      confirmationRequired: true,
      tool: "delete_institution",
    });
    expect((await call("list_institutions")).structuredContent).toMatchObject({
      items: [{ id }],
    });
    const done = await call("delete_institution", {
      id,
      idempotencyKey: "k2",
      confirmation: "confirm",
    });
    expect(done.structuredContent).toEqual({ id, deleted: true });
  });

  test("a refusal carries its code and the rule's own words", async () => {
    const { call } = await agent();
    const party = await call("create_party", {
      key: "bar",
      name: "Bar",
      type: "COMPANY",
      idempotencyKey: "k1",
    });
    const fees = await call("create_financial_category", {
      name: "Taxas",
      kind: "REVENUE",
      role: "DEDUCTION",
      idempotencyKey: "k2",
    });
    const refused = await call("create_revenue", {
      key: "fee",
      partyId: (party.structuredContent as { id: string }).id,
      financialCategoryId: (fees.structuredContent as { id: string }).id,
      amount: "100",
      currency: "BRL",
      referenceMonth: "2026-11-01",
      idempotencyKey: "k3",
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: { code: "SIGNED_ITEM", status: 422 },
    });
    expect(refused.content[0]?.text).toStartWith("SIGNED_ITEM: ");
  });

  test("another Book's id is refused, and a viewer cannot write", async () => {
    const { call } = await agent();
    expect(
      (await call("list_accounts", { bookId: "2" })).structuredContent,
    ).toMatchObject({
      error: { code: "UNAUTHORIZED_OR_NOT_FOUND" },
    });
    const viewer = await agent("viewer");
    expect(
      (
        await viewer.call("create_institution", {
          key: "x",
          name: "X",
          idempotencyKey: "k",
        })
      ).structuredContent,
    ).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  test("list_books answers for the credential's operator, outside any Book", async () => {
    const { call, host } = await agent();
    const core = (host.modules as { core: CoreApi }).core;
    const book = await core.admin.ensureBook({ key: "bar", name: "Bar" });
    await core.admin.setBookMember({
      bookId: book.id,
      userId: "editor",
      role: "EDITOR",
    });
    expect((await call("list_books")).structuredContent).toMatchObject({
      items: [{ key: "bar" }],
    });
  });
});
