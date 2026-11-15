/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { closeTestHost } from "@lastro/close/testing";
import type { CoreApi } from "@lastro/core";
import type { LastroHost } from "@lastro/host";
import { createMcp } from "./app";

/* The Streamable HTTP endpoint with a real credential over the memory modules. */
async function endpoint() {
  const { host } = closeTestHost();
  const core = (host.modules as { core: CoreApi }).core;
  const book = await core.admin.ensureBook({ key: "bar", name: "Bar" });
  await core.admin.setBookMember({
    bookId: book.id,
    userId: "editor",
    role: "EDITOR",
  });
  const { token } = await core.admin.issueAgentCredential({
    bookId: book.id,
    principal: "agent:test",
    delegatedOperator: "editor",
    issuedBy: "test",
  });
  const log: Record<string, unknown>[] = [];
  const app = createMcp({
    host: host as unknown as LastroHost,
    ping: async () => true,
    log: (event) => log.push(event),
  });
  const moduleOf = (name: string) =>
    host.operations.find((each) => each.mcp.name === name)?.id.split(".")[0];
  const call = (
    name: string,
    args: Record<string, unknown>,
    path = `/mcp/${moduleOf(name)}`,
  ) =>
    app.request(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  return { app, call, log };
}

describe("the MCP endpoint", () => {
  test("logs each tool call with its outcome and never its arguments", async () => {
    const { call, log } = await endpoint();
    await call("list_books", {});
    await call("create_institution", {
      key: "secret-key",
      name: "Secret",
      idempotencyKey: "k",
    });
    await call("create_institution", { key: "x" });
    expect(
      log.map((event) => [event.tool, event.outcome, event.principal]),
    ).toEqual([
      ["list_books", "ok", "agent:test"],
      ["create_institution", "ok", "agent:test"],
      ["create_institution", "error", "agent:test"],
    ]);
    expect(JSON.stringify(log)).not.toContain("secret-key");
  });

  test("each module has its endpoint, and a tool answers only on its own", async () => {
    const { app, call } = await endpoint();
    const index = await app.request("/mcp");
    expect(index.status).toBe(404);
    expect(((await index.json()) as { endpoints: string[] }).endpoints).toEqual(
      expect.arrayContaining(["/mcp/core", "/mcp/finance", "/mcp/sales"]),
    );
    expect((await app.request("/mcp/ghost", { method: "POST" })).status).toBe(
      404,
    );
    const misplaced = await call("list_accounts", {}, "/mcp/sales");
    expect(JSON.stringify(await misplaced.json())).toContain("list_accounts");
    expect(
      (
        (await (await call("list_accounts", {})).json()) as {
          result?: { isError?: boolean };
        }
      ).result?.isError,
    ).toBeFalsy();
  });

  test("an unknown credential is refused, and liveness needs no database", async () => {
    const { app } = await endpoint();
    const refused = await app.request("/mcp/core", {
      method: "POST",
      headers: { authorization: "Bearer a.b" },
    });
    expect(refused.status).toBe(404);
    expect(await (await app.request("/health/live")).json()).toEqual({
      status: "live",
    });
  });
});
