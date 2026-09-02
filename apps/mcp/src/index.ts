import { parseEnv } from "@lastro/config";
import { pingDatabase } from "@lastro/db";
import { createMcp } from "./app";

const env = parseEnv();
const app = createMcp({ ping: () => pingDatabase(env.DATABASE_URL) });
const port = Number(process.env.PORT ?? "3002");

export const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
});
