import { createApplication } from "@lastro/application";
import { createAuthService } from "@lastro/auth";
import { parseEnv } from "@lastro/config";
import { createDb, createRepositories, pingDatabase } from "@lastro/db";
import { createApi } from "./app";

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const repositories = createRepositories(db);
const app = createApi({
  ping: () => pingDatabase(env.DATABASE_URL),
  application: createApplication(repositories),
  auth: createAuthService(repositories.auth),
});
const port = Number(process.env.PORT ?? "3001");

export const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? "127.0.0.1",
  fetch: app.fetch,
});
