/// <reference types="bun-types" />
/** The MCP server: one endpoint per composed module. */
import { parseEnv } from "@lastro/config";
import { createDb, createHost } from "@lastro/host";
import { sql } from "drizzle-orm";
import { createMcp, startStdioMcp } from "./app";

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const options = {
  host: createHost(db),
  log: (event: Record<string, unknown>) => console.error(JSON.stringify(event)),
  ping: async () => {
    await db.execute(sql`select 1`);
    return true;
  },
};

export const server =
  process.env.MCP_TRANSPORT === "stdio"
    ? undefined
    : Bun.serve({
        port: Number(process.env.PORT ?? "3002"),
        hostname: process.env.HOST ?? "127.0.0.1",
        fetch: createMcp(options).fetch,
      });

if (process.env.MCP_TRANSPORT === "stdio") {
  const bearer = process.env.MCP_BEARER_TOKEN;
  const bookId = process.env.MCP_BOOK_ID;
  const moduleId = process.env.MCP_MODULE;
  if (!bearer || !bookId || !moduleId)
    throw new Error(
      "MCP_BEARER_TOKEN, MCP_BOOK_ID and MCP_MODULE are required for stdio",
    );
  await startStdioMcp(options, { bearer, bookId, moduleId });
}
