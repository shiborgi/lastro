import { resolve } from "node:path";
import { $ } from "bun";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

export async function requireCompose(): Promise<void> {
  try {
    await $`docker compose version`.quiet();
  } catch {
    throw new Error("docker compose is required for bun run test:integration");
  }
}

export async function composeUp(): Promise<void> {
  await $`docker compose up -d --wait`.cwd(REPO_ROOT);
}

export async function composeDown(): Promise<void> {
  await $`docker compose down -v`.cwd(REPO_ROOT).quiet();
}

export async function waitForJson(
  url: string,
  timeoutMs = 20000,
): Promise<{ status: number; body: unknown }> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      return { status: response.status, body: await response.json() };
    } catch (error) {
      lastError = error;
      await Bun.sleep(200);
    }
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}
