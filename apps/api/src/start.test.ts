/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const cwd = resolve(import.meta.dir, "..");

describe("api start", () => {
  test("exits nonzero before listen when DATABASE_URL is missing", async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "DATABASE_URL"),
    );
    const proc = Bun.spawn(["bun", "src/index.ts"], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    expect(code).not.toBe(0);
    expect(`${stderr}\n${stdout}`).toMatch(/DATABASE_URL/);
  });
});
