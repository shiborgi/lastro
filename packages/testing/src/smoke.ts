#!/usr/bin/env bun
/*
 * The install path, end to end, on a throwaway database: an empty database,
 * the init, bootstrap, the demo seed, then the API, the MCP server and the web
 * app as deployed, and an agent listing its Books over MCP and a person
 * signing in through the web proxy.
 *
 * Uses the integration suite's PostgreSQL (docker-compose.test.yml, port
 * 55432) and a database of its own, and tears both down at the end. It never
 * follows an ambient DATABASE_URL. The web app must be built (`bun run build`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { $ } from "bun";
import postgres from "postgres";
import {
  REPO_ROOT,
  composeDown,
  composeUp,
  requireCompose,
  waitForJson,
} from "./compose";

const ROOT = `${REPO_ROOT}/`;
const ADMIN_URL = "postgres://lastro:lastro@localhost:55432/lastro";
const DATABASE = "lastro_smoke";
const DATABASE_URL = ADMIN_URL.replace(/\/lastro$/, `/${DATABASE}`);
const PORTS = { api: "3566", mcp: "3567", web: "3568" };
const SECRET = "smoke-test-secret-value-of-32-characters";
const OWNER = { email: "owner@lastro.test", password: "smoke-test-passphrase" };

const step = (text: string) => console.log(`\n▸ ${text}`);
const env = {
  ...process.env,
  DATABASE_URL,
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: `http://127.0.0.1:${PORTS.api}`,
  // The browser reaches Better Auth through the web app's origin, as deployed.
  LASTRO_TRUSTED_ORIGINS: `http://127.0.0.1:${PORTS.web}`,
};
const children: ReturnType<typeof Bun.spawn>[] = [];
const run = (args: string[]) => $`bun ${args}`.cwd(ROOT).env(env);

await requireCompose();
await composeUp();
try {
  step("an empty database");
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`drop database if exists ${DATABASE}`);
  await admin.unsafe(`create database ${DATABASE}`);
  await admin.end({ timeout: 5 });

  step("init, twice: the second applies nothing");
  await run(["packages/host/src/initialize.ts"]);
  const again = await run(["packages/host/src/initialize.ts"]).text();
  if (!again.includes("up to date"))
    throw new Error(`the second init applied something: ${again}`);

  step("bootstrap: owner, Book and an EDITOR agent credential");
  const output = await run([
    "scripts/bootstrap.ts",
    "--email",
    OWNER.email,
    "--password",
    OWNER.password,
    "--book",
    "Bar",
    "--delegate",
    "agent@lastro.local",
    "--role",
    "EDITOR",
    "--agent",
    "agent:example",
  ]).text();
  const token = /MCP_BEARER_TOKEN=(\S+)/.exec(output)?.[1];
  if (!token) throw new Error(`bootstrap printed no credential:\n${output}`);
  const rerun = await run([
    "scripts/bootstrap.ts",
    "--email",
    OWNER.email,
    "--book",
    "Bar",
  ]).text();
  if (!rerun.includes("Owner already exists"))
    throw new Error("bootstrap is not idempotent for the owner");

  step("demo seed, twice: the second is a replay");
  await run(["scripts/seed-demo.ts"]);
  await run(["scripts/seed-demo.ts"]);

  step("API, MCP and web as deployed");
  const spawn = (cmd: string[], port: string, cwd = ROOT) => {
    const child = Bun.spawn(cmd, {
      cwd,
      env: {
        ...env,
        PORT: port,
        LASTRO_API_URL: `http://127.0.0.1:${PORTS.api}`,
      },
      stdout: "ignore",
      stderr: "inherit",
    });
    children.push(child);
  };
  spawn(["bun", "apps/api/src/index.ts"], PORTS.api);
  spawn(["bun", "apps/mcp/src/index.ts"], PORTS.mcp);
  spawn(
    ["bunx", "next", "start", "-p", PORTS.web],
    PORTS.web,
    `${ROOT}apps/web`,
  );
  for (const port of [PORTS.api, PORTS.mcp]) {
    const health = await waitForJson(`http://127.0.0.1:${port}/health`);
    if (health.status !== 200)
      throw new Error(`port ${port} is not healthy: ${JSON.stringify(health)}`);
  }

  step("the agent lists its Book over /mcp/core and writes over /mcp/finance");
  // One MCP server per module: the agent connects to each it uses.
  const clients: Client[] = [];
  const connect = async (moduleId: string) => {
    const client = new Client({ name: "smoke", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${PORTS.mcp}/mcp/${moduleId}`),
        {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        },
      ),
    );
    clients.push(client);
    return client;
  };
  const core = await connect("core");
  const finance = await connect("finance");
  const imports = await connect("finance-imports");
  const books = (await core.callTool({ name: "list_books", arguments: {} }))
    .structuredContent as {
    items: { id: string; key: string }[];
  };
  if (books.items.map((each) => each.key).join() !== "bar")
    throw new Error(`list_books: ${JSON.stringify(books)}`);
  const write = await finance.callTool({
    name: "create_account",
    arguments: {
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
      idempotencyKey: "smoke-1",
    },
  });
  if (write.isError)
    throw new Error(
      `the EDITOR agent could not write: ${JSON.stringify(write.structuredContent)}`,
    );
  console.log(
    `  list_books → ${books.items.map((each) => each.key).join(", ")}; create_account → ok`,
  );

  step(
    "the agent routes the account to the Nubank reader over /mcp/finance-imports, imports a statement twice, and nothing is staged twice",
  );
  const accountId = (write.structuredContent as { id: string }).id;
  const content = readFileSync(
    resolve(
      import.meta.dir,
      "../../../modules/finance-imports/src/parsers/nubank-account/fixtures/month.csv",
    ),
    "utf8",
  );
  const consumer = await imports.callTool({
    name: "set_movement_consumer",
    arguments: {
      accountId,
      type: "account-movements",
      importerId: "nubank/account",
      idempotencyKey: "smoke-consumer",
    },
  });
  if (consumer.isError)
    throw new Error(
      `set_movement_consumer: ${JSON.stringify(consumer.structuredContent ?? consumer.content)}`,
    );
  const intake = async (key: string) => {
    const answer = await imports.callTool({
      name: "import_movements",
      arguments: {
        accountId,
        type: "account-movements",
        key: "drive/extratos/nubank/month.csv",
        content,
        idempotencyKey: key,
      },
    });
    if (answer.isError)
      throw new Error(
        `import_movements: ${JSON.stringify(answer.structuredContent ?? answer.content)}`,
      );
    return answer.structuredContent as {
      new: number;
      alreadyImported: boolean;
    };
  };
  const first = await intake("smoke-nubank-1");
  const second = await intake("smoke-nubank-2");
  const count = async (name: string) =>
    (
      (await finance.callTool({ name, arguments: {} })).structuredContent as {
        items: unknown[];
      }
    ).items.length;
  const payments = await count("list_payment_movements");
  const receipts = await count("list_receipt_movements");
  if (first.new !== 3 || !second.alreadyImported || payments + receipts !== 3)
    throw new Error(
      `statement intake: first ${JSON.stringify(first)}, second ${JSON.stringify(second)}, ${payments} payment and ${receipts} receipt movements`,
    );
  const misplaced = await core.callTool({
    name: "list_payment_movements",
    arguments: {},
  });
  if (!misplaced.isError) throw new Error("/mcp/core answered a finance tool");
  for (const client of clients) await client.close();
  console.log(
    `  set_movement_consumer → ok; import_movements → ${first.new} new; again → already imported; ${payments} payment + ${receipts} receipt movements`,
  );

  step(
    "the owner signs in through the web app and reads the Book through its proxy",
  );
  const web = `http://127.0.0.1:${PORTS.web}`;
  const deadline = Date.now() + 30_000;
  while ((await fetch(`${web}/`).catch(() => null))?.status !== 200) {
    if (Date.now() > deadline) throw new Error("the web app did not start");
    await Bun.sleep(300);
  }
  const signIn = await fetch(`${web}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: web },
    body: JSON.stringify(OWNER),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((each) => each.split(";")[0])
    .join("; ");
  if (!signIn.ok || !cookie)
    throw new Error(`sign-in failed with ${signIn.status}`);
  const accounts = await fetch(
    `${web}/api/backend/v1/books/${books.items[0]?.id}/accounts`,
    { headers: { cookie } },
  );
  const body = (await accounts.json()) as { items: { key: string }[] };
  if (body.items.map((each) => each.key).join() !== "bank")
    throw new Error(`accounts via the web: ${JSON.stringify(body)}`);
  console.log("  / → 200; sign-in → session; accounts via /api/backend → bank");

  console.log("\nsmoke passed");
} finally {
  for (const child of children) child.kill();
  await Promise.all(children.map((child) => child.exited));
  await composeDown();
}
