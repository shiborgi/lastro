/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const compose = readFileSync(
  resolve(repoRoot, "docker-compose.release.yml"),
  "utf8",
);
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const backupScript = readFileSync(
  resolve(repoRoot, "scripts/backup-restore.ts"),
  "utf8",
);
const dockerignore = readFileSync(resolve(repoRoot, ".dockerignore"), "utf8");

describe("WAVE-2.1 container stack hardening", () => {
  test("release compose includes web, migrate, api, mcp, and worker", () => {
    for (const service of ["web", "migrate", "api", "mcp", "worker"]) {
      expect(compose).toContain(`  ${service}:`);
    }
  });

  test("web connects to api over the container network and depends on api", () => {
    expect(compose).toContain(
      "LASTRO_API_URL: ${LASTRO_API_URL:-http://api:3001}",
    );
    expect(compose).toContain("api:");
    expect(compose).toContain("condition: service_started");
  });

  test("services depend on migrate completing successfully", () => {
    expect(compose).toContain("condition: service_completed_successfully");
  });

  test("Dockerfile builds the web via the container build", () => {
    expect(dockerfile).toContain("bun run build");
    expect(dockerfile).toContain("COPY apps apps");
  });

  test("build context excludes host artifacts", () => {
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".next");
  });

  test("backup/restore run inside the container without host pg_dump", () => {
    expect(backupScript).toContain("docker compose");
    expect(backupScript).toContain("exec -T postgres pg_dump");
    expect(backupScript).toContain("exec -T postgres pg_restore");
  });
});
