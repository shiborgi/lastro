/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { initializeDatabase } from "./initialize";
import { moduleOrder } from "./modules";

const init = resolve(import.meta.dir, "../drizzle/0000_init.sql");
const moduleDb = (id: string, file: string) =>
  resolve(import.meta.dir, "../../../modules", id, "src/db", file);

/*
 * A module's schema.ts, its triggers.sql and the SQL applied at boot are
 * three artefacts that must not drift apart, and nothing else notices when
 * they do: the init still applies, the tables still exist, and a rule that
 * stopped reaching the database fails silently. These tests are the signal.
 * They are driven by the module list, so a new module is covered by being
 * listed.
 */
async function declaredBy(id: string) {
  const schemaFile = moduleDb(id, "schema.ts");
  const triggersFile = moduleDb(id, "triggers.sql");
  const tables: string[] = [];
  let checks: string[] = [];
  if (existsSync(schemaFile)) {
    const schema = (await import(schemaFile)) as Record<string, unknown>;
    for (const value of Object.values(schema)) {
      if (is(value, PgTable)) tables.push(getTableName(value));
    }
    checks = [
      ...(await readFile(schemaFile, "utf8")).matchAll(
        /\bcheck\(\s*"([a-z0-9_]+)"/g,
      ),
    ].map((match) => match[1] as string);
  }
  const triggerSql = existsSync(triggersFile)
    ? await readFile(triggersFile, "utf8")
    : "";
  const names = (pattern: RegExp) =>
    [...triggerSql.matchAll(pattern)].map((match) => match[1] as string);
  return {
    tables,
    checks,
    functions: names(/^CREATE OR REPLACE FUNCTION ([a-z0-9_]+)\(/gm),
    triggers: names(/^CREATE (?:CONSTRAINT )?TRIGGER ([a-z0-9_]+)/gm),
  };
}

describe("the generated init", () => {
  test("carries every table, check, function and trigger a module declares", async () => {
    const sql = await readFile(init, "utf8");
    let tables = 0;
    for (const id of moduleOrder) {
      const declared = await declaredBy(id);
      tables += declared.tables.length;
      for (const table of declared.tables)
        expect(sql).toContain(`CREATE TABLE "${table}"`);
      // drizzle-kit 0.24 silently dropped every `check()`; never again.
      for (const check of declared.checks)
        expect(sql).toContain(`CONSTRAINT "${check}" CHECK`);
      for (const fn of declared.functions)
        expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${fn}(`);
      for (const trigger of declared.triggers)
        expect(sql).toMatch(
          new RegExp(`CREATE (?:CONSTRAINT )?TRIGGER ${trigger}\\b`),
        );
    }
    expect(tables).toBeGreaterThan(0);
    // Nothing reaches the database without a module that owns it.
    expect(sql.match(/CREATE TABLE "/g)?.length).toBe(tables);
  });

  test("appends module triggers in module order", async () => {
    const sql = await readFile(init, "utf8");
    const appended = [...sql.matchAll(/^-- module: ([a-z-]+)$/gm)].map(
      (match) => match[1] as string,
    );
    const expected = moduleOrder.filter((id) => appended.includes(id));
    expect(appended).toEqual([...expected]);
  });

  test("every statement between breakpoints is non-empty", async () => {
    const statements = (await readFile(init, "utf8"))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim());
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(statement).not.toBe("");
  });
});

describe("initializeDatabase", () => {
  test("rejects instead of hanging when the database is unreachable", async () => {
    await expect(
      initializeDatabase("postgres://lastro:lastro@127.0.0.1:1/lastro"),
    ).rejects.toThrow();
  });
});
