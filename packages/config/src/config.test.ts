/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { validateEnv } from "./index";

describe("config", () => {
  test("fails on missing DATABASE_URL", () => {
    expect(() => validateEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });

  test("fails on malformed DATABASE_URL", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "test", DATABASE_URL: "not-a-url" }),
    ).toThrow(/DATABASE_URL/);
  });

  test("succeeds with required values", () => {
    const env = validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://lastro:lastro@localhost:5432/lastro",
    });
    expect(env.DATABASE_URL).toBe(
      "postgres://lastro:lastro@localhost:5432/lastro",
    );
  });
});
