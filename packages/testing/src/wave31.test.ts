/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const appleScript = readFileSync(
  resolve(repoRoot, "scripts/apple-container.ts"),
  "utf8",
);
const apiIndex = readFileSync(
  resolve(repoRoot, "apps/api/src/index.ts"),
  "utf8",
);
const mcpIndex = readFileSync(
  resolve(repoRoot, "apps/mcp/src/index.ts"),
  "utf8",
);
const compose = readFileSync(
  resolve(repoRoot, "docker-compose.release.yml"),
  "utf8",
);
const rootPackage = readFileSync(resolve(repoRoot, "package.json"), "utf8");
const installDoc = readFileSync(resolve(repoRoot, "docs/install.md"), "utf8");

describe("WAVE-3.1 Apple Container install", () => {
  test("single entrypoint exposes install and ops subcommands", () => {
    for (const sub of [
      "install",
      "stop",
      "start",
      "backup",
      "restore",
      "teardown",
    ]) {
      expect(appleScript).toContain(`"${sub}"`);
    }
    expect(rootPackage).toContain("apple-container");
  });

  test("install builds the image, migrates at boot, and gates on health", () => {
    expect(appleScript).toContain("container build -t");
    expect(appleScript).toContain("container run --rm");
    expect(appleScript).toContain("packages/db/src/migrate.ts");
    expect(appleScript).toContain("pg_isready");
    expect(appleScript).toContain("127.0.0.1:3001/health");
    expect(appleScript).toContain("127.0.0.1:3000/");
  });

  test("hosts stay in sync and worker runs a persistent poll loop", () => {
    expect(appleScript).toContain("syncHosts");
    expect(appleScript).toContain("/etc/hosts");
    expect(appleScript).toContain("apps/worker/src/run.ts");
    expect(compose).toContain("apps/worker/src/run.ts");
  });

  test("backup/restore run inside the container without host pg tools", () => {
    expect(appleScript).toContain("container exec lastro-postgres pg_dump");
    expect(appleScript).toContain("container exec lastro-postgres pg_restore");
    expect(appleScript).toContain("container cp");
  });

  test("services persist data in a named volume and use a dedicated network", () => {
    expect(appleScript).toContain("container volume create");
    expect(appleScript).toContain("container network create");
    expect(appleScript).toContain(":/var/lib/postgresql/data");
    expect(appleScript).toContain("VOLUME = ");
  });

  test("api and mcp bind a configurable host for container port publishing", () => {
    expect(apiIndex).toContain('process.env.HOST ?? "127.0.0.1"');
    expect(mcpIndex).toContain('process.env.HOST ?? "127.0.0.1"');
    expect(compose).toContain("HOST: 0.0.0.0");
    expect(appleScript).toContain("-e HOST=0.0.0.0");
  });

  test("demo seed mints a session token and is idempotent", () => {
    const seed = readFileSync(
      resolve(repoRoot, "scripts/seed-demo.ts"),
      "utf8",
    );
    expect(seed).toContain("createSession");
    expect(seed).toContain("LASTRO_API_TOKEN=");
    expect(seed).toContain("idempotencyKey");
  });

  test("install doc leads with the Apple Container single command", () => {
    expect(installDoc).toContain("Apple Container");
    expect(installDoc).toContain("bun run apple-container install");
  });
});
