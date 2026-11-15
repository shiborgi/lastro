/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { closeDb, openTestDb } from "./database";

const db = openTestDb();
afterAll(() => closeDb(db));

describe("the integration database", () => {
  test("answers, and carries the applied init", async () => {
    const rows = await db.execute<{ filename: string }>(
      sql`select filename from schema_migrations`,
    );
    expect(rows.map((row) => row.filename)).toEqual(["0000_init.sql"]);
  });
});
