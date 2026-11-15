#!/usr/bin/env bun
/*
 * The integration suite: the modules' init, both adapters as deployed, and
 * every `*.integration.ts` beside this file against real PostgreSQL.
 *
 * It uses the same throwaway PostgreSQL as the suite it will replace
 * (docker-compose.test.yml, project `lastro-test`, port 55432) but its own
 * database in it, created from the host's assembled init. It never follows an
 * ambient DATABASE_URL.
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeDatabase } from "@lastro/host";
import postgres from "postgres";
import {
  REPO_ROOT,
  TEST_DATABASE_URL,
  composeDown,
  composeUp,
  requireCompose,
  waitForJson,
} from "../compose";

const DATABASE = "lastro_integration";
export const MODULAR_DATABASE_URL = TEST_DATABASE_URL.replace(
  /\/lastro$/,
  `/${DATABASE}`,
);

await requireCompose();
console.log("Starting postgres (compose project lastro-test, port 55432)...");
await composeUp();

const children: ReturnType<typeof Bun.spawn>[] = [];
try {
  const admin = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists ${DATABASE}`);
    await admin.unsafe(`create database ${DATABASE}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  console.log("Initializing schema (1/2)...");
  const first = await initializeDatabase(MODULAR_DATABASE_URL);
  if (first.applied.length < 1) {
    throw new Error("expected the init to be applied to an empty database");
  }
  // `db-init` runs on every boot, so the second pass must apply nothing.
  console.log("Initializing schema (2/2)...");
  const second = await initializeDatabase(MODULAR_DATABASE_URL);
  if (second.applied.length !== 0) {
    throw new Error(
      `expected the second initialization to apply nothing, applied ${second.applied.join(", ")}`,
    );
  }
  console.log("Schema initialization is idempotent.");

  // Both adapters, as deployed, against this database (P4.3 parity).
  const servers = [
    { entry: "apps/api/src/index.ts", port: "3466" },
    { entry: "apps/mcp/src/index.ts", port: "3467" },
  ].map(({ entry, port }) =>
    Bun.spawn(["bun", entry], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: MODULAR_DATABASE_URL,
        PORT: port,
        BETTER_AUTH_SECRET: "integration-suite-secret-of-32-chars",
        BETTER_AUTH_URL: "http://127.0.0.1:3466",
      },
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  children.push(...servers);
  for (const port of ["3466", "3467"]) {
    const health = await waitForJson(`http://127.0.0.1:${port}/health`);
    if (health.status !== 200)
      throw new Error(
        `server on ${port} is not healthy: ${JSON.stringify(health)}`,
      );
  }

  const suiteDir = resolve(import.meta.dir);
  const files = (await readdir(suiteDir))
    .filter((name) => name.endsWith(".integration.ts"))
    .sort()
    .map((name) => resolve(suiteDir, name));
  if (files.length === 0) throw new Error("no integration tests found");

  const suite = Bun.spawn(["bun", "test", ...files], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: MODULAR_DATABASE_URL,
      API_URL: "http://127.0.0.1:3466",
      MCP_URL: "http://127.0.0.1:3467/mcp",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await suite.exited) !== 0) {
    throw new Error("integration tests failed");
  }
} finally {
  for (const child of children) {
    child.kill();
    await child.exited;
  }
  await composeDown();
}
