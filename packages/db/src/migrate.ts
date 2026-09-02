import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

async function countMigrations(client: postgres.Sql): Promise<number> {
  try {
    const rows =
      await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return Number(rows[0]?.n ?? 0);
  } catch {
    try {
      const rows =
        await client`select count(*)::int as n from __drizzle_migrations`;
      return Number(rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }
}

export async function runMigrate(
  databaseUrl: string,
): Promise<{ applied: number }> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const before = await countMigrations(client);
    await migrate(drizzle(client), { migrationsFolder });
    const after = await countMigrations(client);
    return { applied: after - before };
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isCli = process.argv[1]?.includes("migrate.ts") ?? false;
if (isCli) {
  const url =
    process.env.DATABASE_URL ??
    "postgres://lastro:lastro@localhost:5432/lastro";
  const result = await runMigrate(url);
  console.log(`applied ${result.applied} migrations`);
}
