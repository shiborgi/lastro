import { createApplication } from "@lastro/application";
import { createAuthService } from "@lastro/auth";
import { parseEnv } from "@lastro/config";
import { createDb, createRepositories, pingDatabase } from "@lastro/db";
import { createMcp } from "./app";

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const repositories = createRepositories(db);
const app = createMcp({
  ping: () => pingDatabase(env.DATABASE_URL),
  application: createApplication(repositories),
  auth: createAuthService(repositories.auth),
});
const port = Number(process.env.PORT ?? "3002");

export const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
});
