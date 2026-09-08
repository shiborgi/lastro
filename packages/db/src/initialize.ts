import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

/*
 * Schema bring-up for a self-hosted install. `db-init` runs this on every boot,
 * so it must be safe to re-run: each drizzle/*.sql is applied at most once and
 * recorded in `schema_migrations`, and each file runs inside a transaction so a
 * failure part-way through leaves nothing half-applied.
 */
export async function initializeDatabase(
  databaseUrl: string,
): Promise<{ statements: number; applied: string[]; skipped: string[] }> {
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const client = postgres(databaseUrl, {
    max: 1,
    // "relation schema_migrations already exists, skipping" is the expected
    // path on every boot after the first; printing it buries real warnings.
    onnotice: (notice) => {
      if (notice.code !== "42P07") {
        console.warn(`${notice.severity}: ${notice.message}`);
      }
    },
  });
  const applied: string[] = [];
  const skipped: string[] = [];
  let statements = 0;

  try {
    await client.unsafe(
      `create table if not exists schema_migrations (
         filename text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const done = new Set(
      (
        await client<{ filename: string }[]>`
          select filename from schema_migrations
        `
      ).map((row) => row.filename),
    );

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), "utf8");
      const parts = sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);

      await client.begin(async (tx) => {
        for (const statement of parts) await tx.unsafe(statement);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });

      applied.push(file);
      statements += parts.length;
    }

    return { statements, applied, skipped };
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isCli = process.argv[1]?.includes("initialize.ts") ?? false;
if (isCli) {
  const url =
    process.env.DATABASE_URL ??
    "postgres://lastro:lastro@localhost:5432/lastro";
  const result = await initializeDatabase(url);
  console.log(
    result.applied.length === 0
      ? `schema is up to date (${result.skipped.length} migration(s) already applied)`
      : `applied ${result.applied.length} migration(s), ${result.statements} statements`,
  );
}
