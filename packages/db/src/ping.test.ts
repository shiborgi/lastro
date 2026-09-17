/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { pingDatabase } from "./ping";

describe("pingDatabase", () => {
  test("returns false instead of throwing when the connection is refused", async () => {
    await expect(
      pingDatabase("postgres://lastro:lastro@127.0.0.1:1/lastro"),
    ).resolves.toBe(false);
  });

  test("rejects for a malformed connection string instead of hanging", async () => {
    await expect(pingDatabase("not-a-postgres-url")).rejects.toThrow();
  });
});
