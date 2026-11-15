#!/usr/bin/env bun
/*
 * Rebuilds the single init from the modules: drizzle-kit generates the tables
 * of every module, then each module's hand-written `triggers.sql` is appended
 * in module order. There is one init by design: the project ships a database
 * it creates, not one it upgrades.
 */
import { existsSync } from "node:fs";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $ } from "bun";
import { moduleOrder } from "../src/modules";

const hostDir = resolve(import.meta.dir, "..");
const outDir = resolve(hostDir, "drizzle");
const init = resolve(outDir, "0000_init.sql");

await rm(outDir, { recursive: true, force: true });
await $`bunx drizzle-kit generate --name init`.cwd(hostDir);

for (const id of moduleOrder) {
  const file = resolve(hostDir, "../../modules", id, "src/db/triggers.sql");
  if (!existsSync(file)) continue;
  const sql = (await readFile(file, "utf8")).trim();
  // A file of comments only would reach the database as an empty statement.
  const hasStatement = sql
    .split("\n")
    .some((line) => line.trim() && !line.trim().startsWith("--"));
  if (!hasStatement) continue;
  await appendFile(
    init,
    `\n--> statement-breakpoint\n-- module: ${id}\n${sql}\n`,
  );
}
// A doubled breakpoint in a hand-written file would reach the database as an
// empty statement; keep the init to real statements only.
const BREAK = "--> statement-breakpoint";
const statements = (await readFile(init, "utf8"))
  .split(BREAK)
  .map((statement) => statement.trim())
  .filter(Boolean);
await writeFile(init, `${statements.join(`\n${BREAK}\n`)}\n`);
console.log(`regenerated ${init}`);
