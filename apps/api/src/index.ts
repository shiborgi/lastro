/// <reference types="bun-types" />
/** The API server: every operation of the composed host. */
import { parseEnv } from "@lastro/config";
import { createDb, createHost } from "@lastro/host";
import { sql } from "drizzle-orm";
import { createHttp } from "./app";
import { createSessions, sessionUserOf } from "./auth";

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const sessions = createSessions(db);
const app = createHttp({
  host: createHost(db),
  ping: async () => {
    await db.execute(sql`select 1`);
    return true;
  },
  sessionUser: sessionUserOf(sessions),
  authHandler: (request) => sessions.handler(request),
});

export const server = Bun.serve({
  port: Number(process.env.PORT ?? "3001"),
  hostname: process.env.HOST ?? "127.0.0.1",
  fetch: app.fetch,
});
