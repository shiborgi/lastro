#!/usr/bin/env bun
import { initializeDatabase } from "@lastro/db";
import {
  DATABASE_URL,
  REPO_ROOT,
  composeDown,
  composeUp,
  requireCompose,
  waitForJson,
} from "./compose";

await requireCompose();
console.log("Starting postgres via docker compose up -d...");
await composeUp();

const children: ReturnType<typeof Bun.spawn>[] = [];

try {
  console.log("Initializing schema (1/2)...");
  const first = await initializeDatabase(DATABASE_URL);
  if (first.applied.length + first.skipped.length < 1) {
    throw new Error("expected at least one migration file to exist");
  }

  // `db-init` runs on every boot, so the second pass must be a no-op: each
  // migration is applied once and recorded, never replayed.
  console.log("Initializing schema (2/2)...");
  const second = await initializeDatabase(DATABASE_URL);
  if (second.applied.length !== 0) {
    throw new Error(
      `expected the second initialization to apply nothing, applied ${second.applied.join(", ")}`,
    );
  }
  if (second.skipped.length !== first.applied.length + first.skipped.length) {
    throw new Error("expected every migration to be recorded as applied");
  }
  console.log("Schema initialization is idempotent.");

  // The API refuses to boot without a Better Auth secret; the suite exercises
  // agent-credential auth, so any valid-length value works here.
  const betterAuthSecret =
    process.env.BETTER_AUTH_SECRET ??
    "integration-suite-secret-value-32-chars-min";

  const api = Bun.spawn(["bun", "apps/api/src/index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: "3456",
      BETTER_AUTH_SECRET: betterAuthSecret,
      BETTER_AUTH_URL: "http://127.0.0.1:3456",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const mcp = Bun.spawn(["bun", "apps/mcp/src/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL, PORT: "3457" },
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(api, mcp);

  const apiHealth = await waitForJson("http://127.0.0.1:3456/health");
  const mcpHealth = await waitForJson("http://127.0.0.1:3457/health");
  const apiBody = apiHealth.body as { database?: { status?: string } };
  const mcpBody = mcpHealth.body as { database?: { status?: string } };
  if (apiHealth.status !== 200 || apiBody.database?.status !== "up") {
    throw new Error(
      `api health did not report database up: ${JSON.stringify(apiHealth)}`,
    );
  }
  if (mcpHealth.status !== 200 || mcpBody.database?.status !== "up") {
    throw new Error(
      `mcp health did not report database up: ${JSON.stringify(mcpHealth)}`,
    );
  }
  console.log("PostgreSQL and service health endpoints reported database up.");

  const invariants = Bun.spawn(
    [
      "bun",
      "test",
      "./packages/testing/src/db-tenancy-and-audit.integration.ts",
      "./packages/testing/src/expense-settlement-invariants.integration.ts",
      "./packages/testing/src/api-mcp-read-parity.integration.ts",
      "./packages/testing/src/revenue-transfer-invariants.integration.ts",
      "./packages/testing/src/mcp-write-and-agent-audit.integration.ts",
      "./packages/testing/src/catalog-idempotency.integration.ts",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL,
        API_URL: "http://127.0.0.1:3456",
        MCP_URL: "http://127.0.0.1:3457/mcp",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await invariants.exited) !== 0) {
    throw new Error("PostgreSQL invariant tests failed");
  }
} finally {
  for (const child of children) {
    child.kill();
    await child.exited;
  }
  await composeDown();
}
