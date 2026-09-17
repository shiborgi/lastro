/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { ApplicationRepository } from "@lastro/application";
import { type Database, createRepositories } from "@lastro/db";

/*
 * `packages/testing` is the only workspace allowed to depend on both the
 * application and the database, which makes it the one place this assertion can
 * live. It is a type-level check: the expression below never runs, but it fails
 * the build the moment `createRepositories` stops answering something the port
 * requires — the drift that the old all-optional port could only discover as a
 * runtime throw, on whichever call site happened to reach the missing method
 * first.
 */
describe("the database adapter satisfies the application port", () => {
  test("createRepositories implements every required member", () => {
    const assertion = (db: Database) =>
      createRepositories(db) satisfies ApplicationRepository;
    expect(typeof assertion).toBe("function");
  });
});
