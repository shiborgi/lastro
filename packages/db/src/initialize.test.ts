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
    const schemaDir = resolve(import.meta.dir, "schema");
    const source = (
      await Promise.all(
        (
          await readdir(schemaDir)
        )
          .filter((file) => file.endsWith(".ts"))
          .map((file) => readFile(join(schemaDir, file), "utf8")),
      )
    ).join("\n");

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

  /*
   * The three triggers are hand-written and appended below the generated DDL,
   * because drizzle-kit emits tables and constraints and nothing else. That
   * makes them the one part of the schema a regeneration can delete without
   * any other signal: the migrations still apply, the tables still exist, and
   * settlements quietly start over-allocating their expense while every
   * payment amount stays at zero. This is the signal.
   */
  test("the hand-written triggers survive a regeneration of the schema", async () => {
    const files = await migrationFiles();
    const sql = (
      await Promise.all(
        files.map((file) => readFile(join(migrationsDir, file), "utf8")),
      )
    ).join("\n");

    /*
     * Functions and triggers are listed apart because they do not share a
     * naming rule: one function guards both expenses and revenues, so it backs
     * two triggers under names of their own.
     */
    for (const fn of [
      "expense_settlement_within_total",
      "refresh_payment_amount",
      "refresh_revenue_amount",
      // The chart of accounts nests one level, and a group holds no records —
      // rules a CHECK cannot state, because each has to read another row.
      "category_group_rules",
      "category_must_be_a_leaf",
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${fn}()`);
    }

    for (const trigger of [
      "expense_settlement_within_total_trigger",
      "refresh_payment_amount_trigger",
      "refresh_revenue_amount_trigger",
      "category_group_rules_trigger",
      "expenses_category_leaf_trigger",
      "revenues_category_leaf_trigger",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
    }
  });
});
