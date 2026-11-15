/**
 * The MCP adapter (ADR 12): one server per composed module, each operation
 * of that module a tool derived from its descriptor. No tool here names a
 * business operation.
 *
 * Transport fields an agent sends beside the operation's own input:
 * - `bookId`: optional; when sent it must be the credential's Book, so a
 *   token for another Book is an error, never an empty ledger;
 * - `idempotencyKey`: required on every write;
 * - `confirmation: "confirm"`: required on every destructive operation.
 */
import type { LastroHost } from "@lastro/host";
import {
  type ExecutionContext,
  Id,
  type OperationDescriptor,
  UnauthorizedError,
  toFailure,
} from "@lastro/kernel";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/* The server version an MCP client sees: the release. */
const MCP_VERSION = "0.1.0";

type Host = Pick<LastroHost, "operations" | "execute" | "modules">;

function reply(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: (value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : { value }) as Record<string, unknown>,
  };
}

function refusal(error: unknown) {
  const failure = toFailure(error);
  return {
    content: [
      { type: "text" as const, text: `${failure.code}: ${failure.message}` },
    ],
    structuredContent: {
      error: {
        code: failure.code,
        message: failure.message,
        status: failure.status,
        ...(failure.details ? { details: failure.details } : {}),
      },
    },
    isError: true,
  };
}

/* The operation's own fields, for the tool's listing; refinements stay with the descriptor. */
function shapeOf(descriptor: OperationDescriptor): Record<string, z.ZodType> {
  const input = descriptor.input as unknown as {
    shape?: Record<string, z.ZodType>;
  };
  return input.shape ? { ...input.shape } : {};
}

export function toolSchema(descriptor: OperationDescriptor) {
  return z
    .object({
      ...shapeOf(descriptor),
      ...(descriptor.scope === "book"
        ? {
            bookId: Id.optional().describe(
              "The credential's Book; refused if it is another Book.",
            ),
          }
        : {}),
      ...(descriptor.access === "read"
        ? {}
        : {
            idempotencyKey: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .describe(
                "A key unique to this intended write; retrying with it returns the first answer.",
              ),
          }),
      ...(descriptor.destructive
        ? {
            confirmation: z
              .literal("confirm")
              .optional()
              .describe(
                'Required: "confirm", sent only once the operator has asked for this.',
              ),
          }
        : {}),
    })
    .strict();
}

/** The composed modules an agent can reach, in module order. */
export function mcpModules(host: {
  modules: Readonly<Record<string, unknown>>;
}): string[] {
  return Object.keys(host.modules);
}

/** The tools of one module: its operations, by their id's module prefix. */
export function operationsOf(
  host: Pick<Host, "operations">,
  moduleId: string,
): readonly OperationDescriptor[] {
  return host.operations.filter((descriptor) =>
    descriptor.id.startsWith(`${moduleId}.`),
  );
}

export function createMcpServer(
  host: Host,
  context: ExecutionContext,
  moduleId: string,
) {
  const server = new McpServer({
    name: `lastro-${moduleId}`,
    version: MCP_VERSION,
  });
  const { identity } = host.modules.core;

  for (const descriptor of operationsOf(host, moduleId)) {
    server.registerTool(
      descriptor.mcp.name,
      {
        description: descriptor.mcp.description,
        inputSchema: toolSchema(descriptor),
        annotations: {
          readOnlyHint: descriptor.access === "read",
          destructiveHint: descriptor.destructive,
          idempotentHint: descriptor.access === "read",
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const { bookId, idempotencyKey, confirmation, ...input } = args as {
            bookId?: string;
            idempotencyKey?: string;
            confirmation?: string;
          } & Record<string, unknown>;
          if (bookId !== undefined && bookId !== context.bookId)
            throw new UnauthorizedError();
          if (descriptor.destructive && confirmation !== "confirm")
            return {
              content: [
                {
                  type: "text" as const,
                  text: `${descriptor.mcp.name} needs the operator's confirmation. Ask, then call it again with confirmation: "confirm".`,
                },
              ],
              structuredContent: {
                confirmationRequired: true,
                tool: descriptor.mcp.name,
              },
            };
          const caller =
            descriptor.scope === "user"
              ? identity.userContext({
                  userId: context.actorId,
                  agentPrincipal: context.agentPrincipal,
                  source: "MCP",
                  correlationId: context.correlationId,
                })
              : { ...context, ...(idempotencyKey ? { idempotencyKey } : {}) };
          return reply(await host.execute(descriptor.id, caller, input));
        } catch (error) {
          return refusal(error);
        }
      },
    );
  }
  return server;
}
