import { resolve } from "node:path";
import { $ } from "bun";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");

/*
 * The suite's database is its own: docker-compose.test.yml, run as the compose
 * project `lastro-test` on host port 55432. The `-p` and `-f` flags override
 * any COMPOSE_PROJECT_NAME or COMPOSE_FILE in the environment, so `up` and
 * `down -v` can only ever reach that project — never the default one, and
 * never a database listening on 5432.
 */
export const TEST_COMPOSE_PROJECT = "lastro-test";
export const TEST_COMPOSE_FILE = resolve(REPO_ROOT, "docker-compose.test.yml");
export const TEST_DATABASE_URL =
  "postgres://lastro:lastro@localhost:55432/lastro";

export async function requireCompose(): Promise<void> {
  try {
    await $`docker compose version`.quiet();
  } catch {
    throw new Error("docker compose is required for bun run test:integration");
  }
}

export async function composeUp(): Promise<void> {
  await $`docker compose -p ${TEST_COMPOSE_PROJECT} -f ${TEST_COMPOSE_FILE} up -d --wait`.cwd(
    REPO_ROOT,
  );
}

export async function composeDown(): Promise<void> {
  await $`docker compose -p ${TEST_COMPOSE_PROJECT} -f ${TEST_COMPOSE_FILE} down -v`
    .cwd(REPO_ROOT)
    .quiet();
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
