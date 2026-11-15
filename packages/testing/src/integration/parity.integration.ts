/// <reference types="bun-types" />
/*
 * The two adapters agree (ADR 12): every read an agent can make without an
 * argument answers the same over HTTP and MCP, and a write of each module
 * lands through either. Both servers run as deployed, started by the runner.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHost } from "@lastro/host";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const API = process.env.API_URL as string;
const MCP = process.env.MCP_URL as string;
const db = openTestDb();
const host = createHost(db);

let token = "";
let bookId = "";
// One client per module: each module has its own MCP endpoint.
const clients = new Map<string, Client>();

beforeAll(async () => {
  const { book, members } = await seedBook(db, ["EDITOR"]);
  bookId = book.id;
  token = (
    await host.modules.core.admin.issueAgentCredential({
      bookId,
      principal: "agent:parity",
      delegatedOperator: members.EDITOR,
      issuedBy: "parity-suite",
    })
  ).token;
  for (const moduleId of Object.keys(host.modules)) {
    const client = new Client({ name: "parity", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${MCP}/${moduleId}`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    clients.set(moduleId, client);
  }
});

afterAll(async () => {
  for (const client of clients.values()) await client.close();
  await closeDb(db);
});

async function http(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const moduleId = host.operations
    .find((each) => each.mcp.name === name)
    ?.id.split(".")[0] as string;
  const client = clients.get(moduleId) as Client;
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    structuredContent: Record<string, unknown>;
  };
  return result;
}

describe("HTTP and MCP publish the same operations", () => {
  test("a write of each module lands through either adapter", async () => {
    const viaHttp = await http(
      "POST",
      `/v1/books/${bookId}/accounts`,
      { key: "bank", name: "Bank", type: "ACCOUNT" },
      "w1",
    );
    expect(viaHttp.status).toBe(200);
    const viaMcp = await tool("create_product_category", {
      key: "drinks",
      name: "Bebidas",
      idempotencyKey: "w2",
    });
    expect(viaMcp.isError).toBeFalsy();
    expect((await tool("list_accounts")).structuredContent).toEqual(
      (await http("GET", `/v1/books/${bookId}/accounts`)).body,
    );
    expect(
      (await http("GET", `/v1/books/${bookId}/product-categories`)).body,
    ).toEqual((await tool("list_product_categories")).structuredContent);
  });

  test("every argument-free read answers the same on both", async () => {
    const reads = host.operations.filter(
      (operation) =>
        operation.access === "read" &&
        !operation.http.path.includes(":") &&
        operation.input.safeParse({}).success,
    );
    expect(reads.length).toBeGreaterThan(15);
    for (const operation of reads) {
      const path =
        operation.scope === "user"
          ? `/v1${operation.http.path}`
          : `/v1/books/${bookId}${operation.http.path}`;
      const viaHttp = await http("GET", path);
      const viaMcp = await tool(operation.mcp.name);
      expect({ id: operation.id, body: viaMcp.structuredContent }).toEqual({
        id: operation.id,
        body: viaHttp.body,
      });
    }
  });

  test("a refusal reads the same on both, with the trigger's words", async () => {
    const income = await http(
      "POST",
      `/v1/books/${bookId}/financial-categories`,
      { name: "Vendas", kind: "REVENUE" },
      "w3",
    );
    const customer = await http(
      "POST",
      `/v1/books/${bookId}/parties`,
      { key: "customer", name: "Customer", type: "COMPANY" },
      "w4",
    );
    await http(
      "POST",
      `/v1/books/${bookId}/revenues`,
      {
        key: "sale",
        partyId: customer.body.id,
        financialCategoryId: income.body.id,
        amount: "1000",
        currency: "BRL",
        referenceMonth: "2026-11-01",
      },
      "w5",
    );
    // A deduction role would leave the positive revenue on the wrong side.
    const viaHttp = await http(
      "PATCH",
      `/v1/books/${bookId}/financial-categories/${income.body.id}`,
      { role: "DEDUCTION" },
      "w6",
    );
    const viaMcp = await tool("update_financial_category", {
      id: income.body.id,
      role: "DEDUCTION",
      idempotencyKey: "w7",
    });
    expect(viaHttp.status).toBe(409);
    expect(viaMcp.structuredContent).toMatchObject({
      error: { ...(viaHttp.body.error as object), status: 409 },
    });
    expect((viaHttp.body.error as { message: string }).message).toBe(
      "that change puts an item on the wrong side of the DEDUCTION role",
    );
  });
});
