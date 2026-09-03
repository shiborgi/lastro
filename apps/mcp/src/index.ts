import { createApplication } from "@lastro/application";
import { createAuthService } from "@lastro/auth";
import { parseEnv } from "@lastro/config";
import { createDb, createRepositories, pingDatabase } from "@lastro/db";
import { createMcp, startStdioMcp } from "./app";

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const repositories = createRepositories(db);
const options = {
  ping: () => pingDatabase(env.DATABASE_URL),
  application: createApplication(repositories),
  auth: createAuthService(repositories.auth),
};
const port = Number(process.env.PORT ?? "3002");

export const server =
  process.env.MCP_TRANSPORT === "stdio"
    ? undefined
    : Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: createMcp(options).fetch,
      });

if (process.env.MCP_TRANSPORT === "stdio") {
  const bearer = process.env.MCP_BEARER_TOKEN;
  const bookId = process.env.MCP_BOOK_ID;
  if (!bearer || !bookId)
    throw new Error("MCP_BEARER_TOKEN and MCP_BOOK_ID are required for stdio");
  await startStdioMcp(options, { bearer, bookId });
}
