#!/usr/bin/env bun
import { runMigrate } from "@lastro/db";
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
  console.log("Running migrate (1/2)...");
  const first = await runMigrate(DATABASE_URL);
  if (first.applied < 1) {
    throw new Error(
      `expected first migrate to apply schema, applied ${first.applied}`,
    );
  }

  console.log("Running migrate (2/2)...");
  const second = await runMigrate(DATABASE_URL);
  if (second.applied !== 0) {
    throw new Error(
      `expected second migrate to apply zero changes, applied ${second.applied}`,
    );
  }
  console.log("Second migrate applied 0 schema changes.");

  const api = Bun.spawn(["bun", "apps/api/src/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL, PORT: "3456" },
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
      "./packages/testing/src/wave12.integration.ts",
      "./packages/testing/src/wave13.integration.ts",
      "./packages/testing/src/wave14.integration.ts",
      "./packages/testing/src/wave16.integration.ts",
      "./packages/testing/src/wave17.integration.ts",
      "./packages/testing/src/wave18.integration.ts",
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
    throw new Error(
      "WAVE-1.2/WAVE-1.3/WAVE-1.4 PostgreSQL invariant tests failed",
    );
  }
} finally {
  for (const child of children) {
    child.kill();
    await child.exited;
  }
  await composeDown();
}
