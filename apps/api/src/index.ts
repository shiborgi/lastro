import { parseEnv } from "@lastro/config";
import { pingDatabase } from "@lastro/db";
import { createApi } from "./app";

const env = parseEnv();
const app = createApi({ ping: () => pingDatabase(env.DATABASE_URL) });
const port = Number(process.env.PORT ?? "3001");

export const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
});
