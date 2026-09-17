/**
 * The MCP adapter: the same application handlers the HTTP API calls, exposed as
 * tools over stdio and Streamable HTTP.
 *
 * MCP is an adapter, not a second financial API (ADR 5). Anything the API can
 * reach a tool can reach — an agent should never have less reach than the web
 * app — and every tool goes through the same commands, so no rule lives here.
 */
import type { Application } from "@lastro/application";
import { type AuthService, authenticateMcpRequest } from "@lastro/auth";
import type { ExecutionContext } from "@lastro/domain";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import * as catalog from "./tools/catalog";
import * as financial from "./tools/financial";
import * as statements from "./tools/statements";

type McpOptions = {
  ping: () => Promise<boolean>;
  auth?: AuthService;
  application?: Application;
  log?: (event: Record<string, unknown>) => void;
};

export function createMcpServer(opts: McpOptions, context: ExecutionContext) {
  if (!opts.application) throw new Error("application is required");
  const application = opts.application;
  const server = new McpServer({ name: "lastro", version: "1.0.0" });
  const requireBook = (bookId: string) => {
    if (bookId !== context.bookId) throw new Error("UNAUTHORIZED_OR_NOT_FOUND");
  };
  const deps = { application, context, requireBook };

  catalog.register(server, deps);
  financial.register(server, deps);
  statements.register(server, deps);

  return server;
}

export function createMcp(opts: McpOptions) {
  const app = new Hono();
  app.all("/mcp", async (c) => {
    const startedAt = performance.now();
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as {
      method?: string;
      params?: { name?: string };
    } | null;
    const tool = body?.method === "tools/call" ? body.params?.name : undefined;
    if (!opts.auth || !opts.application)
      return c.json({ error: "UNAUTHORIZED_OR_NOT_FOUND" }, 404);
    const authenticated = await authenticateMcpRequest(
      c.req.raw,
      opts.auth,
      c.req.header("x-book-id") ?? undefined,
    );
    if (!authenticated)
      return c.json({ error: "UNAUTHORIZED_OR_NOT_FOUND" }, 404);
    const context = c.req.header("x-correlation-id")
      ? {
          ...authenticated.context,
          correlationId: c.req.header("x-correlation-id") as string,
        }
      : authenticated.context;
    const server = createMcpServer(opts, context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(c.req.raw);
      if (tool) {
        opts.log?.({
          event: "tool.call",
          tool,
          latencyMs: Math.round(performance.now() - startedAt),
          outcome: response.status < 400 ? "ok" : "error",
        });
      }
      return response;
    } finally {
      await server.close();
    }
  });
  app.get("/health", async (c) => {
    const up = await opts.ping();
    return c.json(
      {
        status: up ? "ok" : "degraded",
        database: { status: up ? "up" : "down" },
      },
      up ? 200 : 503,
    );
  });
  app.get("/health/live", (c) => c.json({ status: "live" }));
  return app;
}

export async function startStdioMcp(
  opts: McpOptions,
  input: { bearer: string; bookId: string },
) {
  if (!opts.auth) throw new Error("auth is required");
  const token = input.bearer.startsWith("Bearer ")
    ? input.bearer.slice(7)
    : input.bearer;
  const separator = token.indexOf(".");
  if (separator <= 0) throw new Error("MCP_BEARER_TOKEN is invalid");
  const authenticated = await opts.auth.authenticateAgent({
    credentialId: token.slice(0, separator),
    secret: token.slice(separator + 1),
    bookId: input.bookId,
  });
  if (!authenticated) throw new Error("MCP credential is unauthorized");
  const server = createMcpServer(opts, authenticated.context);
  await server.connect(new StdioServerTransport());
  return server;
}
