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

/*
 * drizzle-orm wraps driver failures in a DrizzleQueryError, so the PostgreSQL
 * SQLSTATE lives on `cause`. Tests assert on the SQLSTATE because that is the
 * stable contract — the message text is not.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown })?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export async function expectPgError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const actual = pgErrorCode(error);
    if (actual !== code) {
      throw new Error(
        `expected SQLSTATE ${code}, received ${actual}: ${error}`,
      );
    }
    return;
  }
  throw new Error(`expected SQLSTATE ${code}, but the operation resolved`);
}
