/**
 * The MCP adapter's transports: Streamable HTTP at /mcp/<module>, one server
 * per composed module, and stdio for one module (MCP_MODULE).
 */
import { parseBearerCredential } from "@lastro/core";
import type { LastroHost } from "@lastro/host";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createMcpServer, mcpModules } from "./server";

type Options = {
  host: Pick<LastroHost, "operations" | "execute" | "modules">;
  ping: () => Promise<boolean>;
  /** One line per tool call: the tool, its latency and outcome, never its arguments. */
  log?: (event: Record<string, unknown>) => void;
};

export function createMcp(options: Options) {
  const app = new Hono();
  const { identity } = options.host.modules.core;

  const modules = new Set(mcpModules(options.host));
  const endpoints = [...modules].map((id) => `/mcp/${id}`);

  // There is no server of every tool: an agent connects to the modules it uses.
  app.all("/mcp", (c) =>
    c.json(
      {
        error: "NOT_FOUND",
        message: "connect to one module's endpoint",
        endpoints,
      },
      404,
    ),
  );

  app.all("/mcp/:module", async (c) => {
    const moduleId = c.req.param("module");
    if (!modules.has(moduleId))
      return c.json(
        { error: "NOT_FOUND", message: `no module ${moduleId}`, endpoints },
        404,
      );
    const token = parseBearerCredential(c.req.header("authorization") ?? null);
    const agent = token
      ? await identity.authenticateAgent({
          ...token,
          bookId: c.req.header("x-book-id") ?? undefined,
          correlationId: c.req.header("x-correlation-id") ?? undefined,
        })
      : null;
    if (!agent) return c.json({ error: "UNAUTHORIZED_OR_NOT_FOUND" }, 404);
    const startedAt = performance.now();
    const call = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as {
      method?: string;
      params?: { name?: string };
    } | null;
    const server = createMcpServer(options.host, agent.context, moduleId);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(c.req.raw);
      if (call?.method === "tools/call") {
        // A refused call is still a 200 with isError; read the body to tell them apart.
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as { result?: { isError?: boolean } } | null;
        options.log?.({
          event: "tool.call",
          module: moduleId,
          tool: call.params?.name,
          principal: agent.context.agentPrincipal,
          latencyMs: Math.round(performance.now() - startedAt),
          outcome:
            response.status < 400 && !body?.result?.isError ? "ok" : "error",
        });
      }
      return response;
    } finally {
      await server.close();
    }
  });

  // Liveness: the process answers. No database check; use /health for readiness.
  app.get("/health/live", (c) => c.json({ status: "live" }));

  app.get("/health", async (c) => {
    const up = await options.ping().catch(() => false);
    return c.json(
      {
        status: up ? "ok" : "degraded",
        database: { status: up ? "up" : "down" },
      },
      up ? 200 : 503,
    );
  });
  return app;
}

export async function startStdioMcp(
  options: Options,
  input: { bearer: string; bookId: string; moduleId: string },
) {
  if (!mcpModules(options.host).includes(input.moduleId))
    throw new Error(
      `MCP_MODULE must be one of: ${mcpModules(options.host).join(", ")}`,
    );
  const token = parseBearerCredential(
    input.bearer.startsWith("Bearer ")
      ? input.bearer
      : `Bearer ${input.bearer}`,
  );
  if (!token) throw new Error("MCP_BEARER_TOKEN is invalid");
  const agent = await options.host.modules.core.identity.authenticateAgent({
    ...token,
    bookId: input.bookId,
  });
  if (!agent) throw new Error("MCP credential is unauthorized");
  const server = createMcpServer(options.host, agent.context, input.moduleId);
  await server.connect(new StdioServerTransport());
  return server;
}
