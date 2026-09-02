import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return drizzle(client, { schema });
}

export * from "./schema";
export { pingDatabase } from "./ping";
export { runMigrate } from "./migrate";
