/**
 * The PostgreSQL connection. The host owns it and hands it to the modules as
 * a resource; no module opens a connection of its own.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const clients = new WeakMap<object, postgres.Sql>();

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  const database = drizzle(client);
  clients.set(database, client);
  return database;
}

export type Database = ReturnType<typeof createDb>;

export async function closeDb(db: Database): Promise<void> {
  await clients.get(db)?.end({ timeout: 5 });
}
