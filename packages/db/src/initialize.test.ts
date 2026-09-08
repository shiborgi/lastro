/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { initializeDatabase } from "./initialize";
import * as schema from "./schema";

const migrationsDir = resolve(import.meta.dir, "../drizzle");

async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql"));
}

describe("initializeDatabase", () => {
  test("rejects instead of hanging when the database is unreachable", async () => {
    await expect(
      initializeDatabase("postgres://lastro:lastro@127.0.0.1:1/lastro"),
    ).rejects.toThrow();
  });

  test("ships at least one migration and every statement is non-empty", async () => {
    const files = await migrationFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      expect(statements.length).toBeGreaterThan(0);
    }
  });

  test("every table in the schema has a CREATE TABLE in the migrations", async () => {
    const files = await migrationFiles();
    const sql = (
      await Promise.all(
        files.map((file) => readFile(join(migrationsDir, file), "utf8")),
      )
    ).join("\n");

    // `schema.ts` and the SQL applied at boot are two artefacts that must not
    // drift apart; nothing else notices if they do.
    for (const table of Object.values(schema)) {
      const name = (table as { _: { name?: string } })?._?.name;
      if (!name) continue;
      expect(sql).toContain(`CREATE TABLE "${name}"`);
    }
  });

  test("every check constraint declared in the schema reaches the database", async () => {
    const files = await migrationFiles();
    const sql = (
      await Promise.all(
        files.map((file) => readFile(join(migrationsDir, file), "utf8")),
      )
    ).join("\n");
    const source = await readFile(
      resolve(import.meta.dir, "schema.ts"),
      "utf8",
    );

    /*
     * Regression guard. drizzle-kit 0.24 silently dropped every `check()` in
     * the schema, so currency, amount and status guards existed only in
     * TypeScript while the database accepted anything. The integration suite
     * asserts the database itself rejects those rows, so the two counts must
     * agree.
     */
    const declared = [...source.matchAll(/\bcheck\(\s*"([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(sql).toContain(`CONSTRAINT "${name}" CHECK`);
    }
  });
});
