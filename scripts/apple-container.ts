#!/usr/bin/env bun
import { $ } from "bun";

const IMAGE = process.env.LASTRO_IMAGE ?? "lastro:release";
/*
 * Its own container network, so Lastro never shares a subnet with anything
 * else running on this machine. Override to run a second, fully isolated
 * stack side by side (also change LASTRO_PREFIX and the ports).
 */
const NETWORK = process.env.LASTRO_NETWORK ?? "lastro";
const PREFIX = process.env.LASTRO_PREFIX ?? "lastro";
const VOLUME = process.env.LASTRO_VOLUME ?? `${PREFIX}_pgdata`;
const DUMP_PATH = process.env.DUMP_PATH ?? "/tmp/lastro.dump";
const REMOTE_DUMP_PATH = "/tmp/lastro.dump";

/*
 * Published ports bind to loopback only. Nothing is reachable from the LAN;
 * remote access is Tailscale's job, and Tailscale proxies from 127.0.0.1.
 * Set LASTRO_BIND=0.0.0.0 to opt out of that (and expose the stack).
 */
const BIND = process.env.LASTRO_BIND ?? "127.0.0.1";
/*
 * A second publish for the MCP container only, so peers that cannot reach
 * loopback — other container stacks on this host — can call MCP without any of
 * them gaining a route to the dashboard, the API or postgres, which stay on
 * BIND alone. Written as `address:port` because Apple Container rejects two
 * publish specs that share a host port even when the addresses differ, so the
 * extra route needs a port of its own. Typical value on Apple Container:
 * `192.168.64.1:3013` — the host's container-bridge address, which sibling
 * stacks can reach and the LAN cannot.
 */
const MCP_EXTRA_PUBLISH = process.env.LASTRO_MCP_EXTRA_PUBLISH;
const WEB_PORT = Number(process.env.LASTRO_WEB_PORT ?? "3000");
const API_PORT = Number(process.env.LASTRO_API_PORT ?? "3001");
const MCP_PORT = Number(process.env.LASTRO_MCP_PORT ?? "3002");
const PG_PORT = Number(process.env.LASTRO_PG_PORT ?? "5432");

const dbPassword = process.env.LASTRO_DB_PASSWORD ?? "lastro";
const configuredApiUrl = process.env.LASTRO_API_URL;
const databaseUrl = `postgres://lastro:${dbPassword}@postgres:5432/lastro`;

const CONTAINERS = [
  `${PREFIX}-postgres`,
  `${PREFIX}-api`,
  `${PREFIX}-mcp`,
  `${PREFIX}-web`,
];
const [PG, API, MCP, WEB] = CONTAINERS;

const command = process.argv[2];
const flags = process.argv.slice(3);
const wantsTailscale =
  flags.includes("--tailscale") || process.env.LASTRO_TAILSCALE === "true";
const servesMcp =
  flags.includes("--with-mcp") || process.env.LASTRO_TAILSCALE_MCP === "true";

/*
 * Dedicated tailnet ports rather than the default 443, so this stack claims a
 * port of its own and leaves the node's main HTTPS port free for something
 * else — including a second Lastro stack.
 */
const WEB_SERVE_PORT = Number(process.env.LASTRO_TAILSCALE_PORT ?? "8443");
const MCP_SERVE_PORT = Number(process.env.LASTRO_TAILSCALE_MCP_PORT ?? "8444");

/*
 * The App Store build does not put the CLI on PATH, so look there too.
 */
const TAILSCALE_CANDIDATES = [
  process.env.TAILSCALE_BIN,
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
].filter(Boolean) as string[];

async function tailscaleBin(): Promise<string | null> {
  for (const candidate of TAILSCALE_CANDIDATES) {
    const result = await $`${candidate} version`.nothrow().quiet();
    if (result.exitCode === 0) return candidate;
  }
  return null;
}

/** The node's MagicDNS name, e.g. `studio.example-tailnet.ts.net`. */
async function tailnetHost(bin: string): Promise<string> {
  const raw = await $`${bin} status --json`.nothrow().quiet();
  if (raw.exitCode !== 0) {
    throw new Error("tailscale is installed but not running or not logged in");
  }
  const status = JSON.parse(raw.stdout.toString()) as {
    Self?: { DNSName?: string };
  };
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "");
  if (!dnsName) {
    throw new Error(
      "could not read this node's MagicDNS name; enable MagicDNS in the tailnet admin console",
    );
  }
  return dnsName;
}

/*
 * Resolved before the containers start, because Better Auth signs its cookies
 * against this origin: if the browser reaches the dashboard on a name the API
 * does not expect, sign-in fails in a way that looks like wrong credentials.
 * The port is part of the origin — serving on a dedicated port and telling the
 * API about the bare hostname would break sign-in exactly that way.
 */
async function tailscaleOrigin(): Promise<string | null> {
  if (!wantsTailscale) return null;
  const bin = await tailscaleBin();
  if (!bin) {
    throw new Error(
      "--tailscale was requested but the tailscale CLI was not found. Install Tailscale, or set TAILSCALE_BIN.",
    );
  }
  return `https://${await tailnetHost(bin)}:${WEB_SERVE_PORT}`;
}

async function serveOverTailscale(): Promise<void> {
  const bin = await tailscaleBin();
  if (!bin) throw new Error("tailscale CLI not found");
  const host = await tailnetHost(bin);

  await $`${bin} serve --bg --https=${String(WEB_SERVE_PORT)} ${String(WEB_PORT)}`;
  console.log(`\ndashboard: https://${host}:${WEB_SERVE_PORT}`);

  if (servesMcp) {
    await $`${bin} serve --bg --https=${String(MCP_SERVE_PORT)} ${String(MCP_PORT)}`;
    console.log(`mcp:       https://${host}:${MCP_SERVE_PORT}/mcp`);
  }

  console.log(
    "\nReachable from any device on your tailnet, over HTTPS, with no port open to the LAN.",
  );
}

async function exists(name: string): Promise<boolean> {
  const result = await $`container inspect ${name}`.nothrow().quiet();
  return result.exitCode === 0;
}

async function removeIfExists(name: string): Promise<void> {
  if (!(await exists(name))) return;
  await $`container stop ${name}`.nothrow().quiet();
  await $`container rm ${name}`.nothrow().quiet();
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(2000);
  }
}

async function pgReady(): Promise<boolean> {
  const result = await $`container exec ${PG} pg_isready -U lastro -d lastro`
    .nothrow()
    .quiet();
  return result.exitCode === 0;
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function containerIp(name: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const raw = await $`container inspect ${name}`.nothrow().quiet();
      if (raw.exitCode === 0) {
        const info = (
          JSON.parse(raw.stdout.toString()) as {
            status?: { networks?: { ipv4Address: string }[] };
          }[]
        )[0];
        const ip = info.status?.networks?.[0]?.ipv4Address?.split("/")[0];
        if (ip) return ip;
      }
    } catch {
      // inspect shape not settled yet; retry below
    }
    if (Date.now() > deadline)
      throw new Error(`timed out resolving IP for ${name}`);
    await Bun.sleep(2000);
  }
}

async function containerState(name: string): Promise<string> {
  const raw = await $`container inspect ${name}`.quiet();
  const info = (
    JSON.parse(raw.stdout.toString()) as {
      status: { state: string };
    }[]
  )[0];
  return info.status.state;
}

// Apple Container does not resolve container names across containers, and IPs
// change across stop/start, so sync the stable hostnames on every boot.
async function syncHosts(): Promise<void> {
  const pgIp = await containerIp(PG);
  const apiIp = await containerIp(API);
  for (const name of CONTAINERS) {
    const clean =
      await $`container exec ${name} sh -c 'sed -i "/ postgres$/d; / api$/d" /etc/hosts'`
        .nothrow()
        .quiet();
    if (clean.exitCode !== 0) continue;
    await $`container exec ${name} sh -c 'echo "${pgIp} postgres" >> /etc/hosts'`
      .nothrow()
      .quiet();
    await $`container exec ${name} sh -c 'echo "${apiIp} api" >> /etc/hosts'`
      .nothrow()
      .quiet();
  }
}

async function psql(statement: string): Promise<string> {
  const result =
    await $`container exec ${PG} psql -U lastro -d lastro -t -A -c ${statement}`
      .nothrow()
      .quiet();
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

/*
 * The migrations assume they own the database: drizzle-kit emits them without
 * IF NOT EXISTS, because the runner records what it applied instead of
 * replaying. Pointed at a volume that already holds tables it did not create,
 * the first migration fails halfway through with a raw SQL error. Recognise
 * that up front and say what to do about it.
 */
async function assertSchemaIsUpgradable(): Promise<void> {
  const tracked = await psql(
    "select to_regclass('public.schema_migrations') is not null",
  );
  if (tracked === "t") return;

  const existing = await psql(
    "select count(*) from information_schema.tables where table_schema='public'",
  );
  if (Number(existing) === 0) return;

  throw new Error(
    `The volume "${VOLUME}" already holds ${existing} tables but no migration\n` +
      `history, so this schema was not created by Lastro. Installing over it\n` +
      `would fail partway through.\n\n` +
      `Either install alongside it on its own network and volume:\n` +
      `  LASTRO_NETWORK=lastro-b LASTRO_PREFIX=lastro-b LASTRO_VOLUME=lastro_b_pgdata \\\n` +
      `  LASTRO_WEB_PORT=3010 LASTRO_API_PORT=3011 LASTRO_MCP_PORT=3012 LASTRO_PG_PORT=5442 \\\n` +
      `  bun run apple-container install --tailscale\n\n` +
      `or take a backup and start clean:\n` +
      `  bun run apple-container backup\n` +
      `  bun run apple-container teardown --volumes`,
  );
}

async function install(): Promise<void> {
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    // Checked here rather than letting the API container crash-loop on it.
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters before installing.\n" +
        "  Generate one with: openssl rand -base64 32",
    );
  }

  // Fail before building the image if Tailscale was asked for but is not ready.
  const publicOrigin = await tailscaleOrigin();

  await $`container system start`.nothrow().quiet();
  await $`container builder start`.nothrow().quiet();
  await $`container network create ${NETWORK}`.nothrow().quiet();
  await $`container volume create ${VOLUME}`.nothrow().quiet();

  console.log(`building image ${IMAGE}...`);
  await $`container build -t ${IMAGE} -f Dockerfile .`;

  for (const name of CONTAINERS) await removeIfExists(name);

  console.log("starting postgres...");
  await $`container run -d --name ${PG} --network ${NETWORK} -e POSTGRES_USER=lastro -e POSTGRES_PASSWORD=${dbPassword} -e POSTGRES_DB=lastro -e PGDATA=/var/lib/postgresql/data/pgdata -v ${VOLUME}:/var/lib/postgresql/data -p ${BIND}:${String(PG_PORT)}:5432 postgres:16-alpine`;
  await waitFor("postgres", pgReady, 120_000);

  await assertSchemaIsUpgradable();

  console.log("initializing database schema...");
  // The one-off initializer runs before the hosts sync, so it
  // gets the freshly resolved postgres IP directly (no restart concern).
  const pgIp = await containerIp(PG);
  const initializeUrl = `postgres://lastro:${dbPassword}@${pgIp}:5432/lastro`;
  await $`container run --rm --name ${PREFIX}-db-init --network ${NETWORK} -e DATABASE_URL=${initializeUrl} ${IMAGE} bun packages/db/src/initialize.ts`;

  console.log("starting services...");
  // With Tailscale the browser's origin is the tailnet name, not localhost.
  // Better Auth has to agree, or every sign-in is rejected as untrusted.
  const authUrl = publicOrigin ?? `http://127.0.0.1:${API_PORT}`;
  const trustedOrigins = publicOrigin ?? "";

  await $`container run -d --name ${API} --network ${NETWORK} -e DATABASE_URL=${databaseUrl} -e HOST=0.0.0.0 -e PORT=3001 -e BETTER_AUTH_SECRET=${authSecret} -e BETTER_AUTH_URL=${authUrl} -e LASTRO_TRUSTED_ORIGINS=${trustedOrigins} -p ${BIND}:${String(API_PORT)}:3001 ${IMAGE} bun apps/api/src/index.ts`;
  const mcpExtraPublish = MCP_EXTRA_PUBLISH
    ? ["-p", `${MCP_EXTRA_PUBLISH}:3002`]
    : [];
  await $`container run -d --name ${MCP} --network ${NETWORK} -e DATABASE_URL=${databaseUrl} -e HOST=0.0.0.0 -e PORT=3002 -p ${BIND}:${String(MCP_PORT)}:3002 ${mcpExtraPublish} ${IMAGE} bun apps/mcp/src/index.ts`;

  // The web app reaches the API through the stable `api` hostname that
  // syncHosts maintains in /etc/hosts, not a raw IP: Apple Container reassigns
  // IPs on every stop/start, and a baked IP goes stale the moment the stack
  // restarts (sign-in then fails with a connection-refused proxy error).
  const webApiUrl = configuredApiUrl ?? `http://api:3001`;
  await $`container run -d --name ${WEB} --network ${NETWORK} -w /app/apps/web -e LASTRO_API_URL=${webApiUrl} -p ${BIND}:${String(WEB_PORT)}:3000 ${IMAGE} bun run start`;

  console.log("syncing container hostnames...");
  await syncHosts();

  console.log("waiting for health...");
  await waitFor(
    "api health",
    () => httpOk(`http://127.0.0.1:${API_PORT}/health`),
    120_000,
  );
  await waitFor(
    "mcp health",
    () => httpOk(`http://127.0.0.1:${MCP_PORT}/health`),
    120_000,
  );
  await waitFor("web", () => httpOk(`http://127.0.0.1:${WEB_PORT}/`), 180_000);
  for (const name of CONTAINERS) {
    const state = await containerState(name);
    if (state !== "running") throw new Error(`${name} is ${state}`);
  }

  console.log(
    `\ninstall complete on network "${NETWORK}", bound to ${BIND}: web :${WEB_PORT}, api :${API_PORT}, mcp :${MCP_PORT}`,
  );

  if (publicOrigin) await serveOverTailscale();

  console.log(
    `\nCreate the first account and Book:\n` +
      `  DATABASE_URL=postgres://lastro:${dbPassword}@127.0.0.1:${PG_PORT}/lastro \\\n` +
      `  BETTER_AUTH_SECRET=<the same secret> \\\n` +
      `  bun run bootstrap --email you@example.com --password '<a long passphrase>'`,
  );
}

async function stop(): Promise<void> {
  for (const name of [...CONTAINERS].reverse()) {
    await $`container stop ${name}`.nothrow().quiet();
  }
  console.log("stopped (data kept)");
}

async function start(): Promise<void> {
  for (const name of CONTAINERS) {
    if (await exists(name)) await $`container start ${name}`.nothrow().quiet();
  }
  await syncHosts();
  console.log("started");
}

/*
 * `tailscale serve` config is a single machine-wide table, not one config per
 * stack. `serve reset` wipes it entirely, so calling it unconditionally from
 * one stack's teardown can silently kill the dashboard of a *different* stack
 * still running side by side (LASTRO_PREFIX makes that a supported setup).
 * Turn off only the tailnet-side ports that proxy to *this* stack's local
 * ports, by name — never a blanket reset.
 */
async function routesOwnedByThisStack(
  bin: string,
): Promise<{ tailnetPort: string }[]> {
  const raw = await $`${bin} serve status --json`.nothrow().quiet();
  if (raw.exitCode !== 0) return [];
  try {
    const status = JSON.parse(raw.stdout.toString()) as {
      Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
    };
    const owned: { tailnetPort: string }[] = [];
    for (const [hostAndPort, entry] of Object.entries(status.Web ?? {})) {
      const tailnetPort = hostAndPort.split(":").at(-1);
      if (!tailnetPort) continue;
      for (const handler of Object.values(entry.Handlers ?? {})) {
        const localPort = Number(handler.Proxy?.match(/:(\d+)$/)?.[1]);
        if (localPort === WEB_PORT || localPort === MCP_PORT) {
          owned.push({ tailnetPort });
        }
      }
    }
    return owned;
  } catch {
    return [];
  }
}

async function unserveTailscale(quiet = false): Promise<void> {
  const bin = await tailscaleBin();
  if (!bin) {
    if (!quiet) console.log("tailscale CLI not found; nothing to reset");
    return;
  }
  const owned = await routesOwnedByThisStack(bin);
  if (owned.length === 0) return;
  for (const { tailnetPort } of owned) {
    await $`${bin} serve --https=${tailnetPort} off`.nothrow().quiet();
  }
  if (!quiet) {
    console.log(
      `tailscale serve route(s) removed: ${owned.map((r) => r.tailnetPort).join(", ")}`,
    );
  }
}

async function teardown(withVolumes: boolean): Promise<void> {
  await stop();
  for (const name of CONTAINERS) await removeIfExists(name);
  await $`container network rm ${NETWORK}`.nothrow().quiet();
  // Leaving a serve route pointing at a dead port would 502 for the tailnet —
  // but only clear it if it was this stack's own route (see unserveTailscale).
  await unserveTailscale(true);
  if (withVolumes) {
    await $`container volume rm ${VOLUME}`.nothrow().quiet();
    console.log("teardown complete (data removed)");
  } else {
    console.log("teardown complete (data kept)");
  }
}

async function backup(): Promise<void> {
  await $`container exec ${PG} pg_dump -U lastro -d lastro -Fc -f ${REMOTE_DUMP_PATH}`;
  await $`container cp ${PG}:${REMOTE_DUMP_PATH} ${DUMP_PATH}`;
  console.log(`backup written to ${DUMP_PATH}`);
}

async function restore(): Promise<void> {
  await $`container cp ${DUMP_PATH} ${PG}:${REMOTE_DUMP_PATH}`;
  await $`container exec ${PG} pg_restore -U lastro -d lastro --clean --if-exists ${REMOTE_DUMP_PATH}`;
  console.log(`restored from ${DUMP_PATH}`);
}

const usage = `usage: bun scripts/apple-container.ts <command>

  install [--tailscale] [--with-mcp]   build and start the stack
  tailscale [--with-mcp]               publish an already-running stack on the tailnet
  untailscale                          remove the tailscale serve config
  stop | start | ps                    lifecycle (data kept)
  logs <service> [--follow]            api | mcp | web | postgres
  backup | restore                     pg_dump / pg_restore via $DUMP_PATH
  teardown [--volumes]                 remove containers (and data with --volumes)

Environment:
  BETTER_AUTH_SECRET   required, 32+ characters (openssl rand -base64 32)
  LASTRO_DB_PASSWORD   postgres password (default: lastro)
  LASTRO_NETWORK       container network name (default: lastro)
  LASTRO_PREFIX        container name prefix (default: lastro)
  LASTRO_BIND          host bind address (default: 127.0.0.1)
  LASTRO_MCP_EXTRA_PUBLISH  extra "address:port" for MCP only, e.g.
                         192.168.64.1:3013 (the container bridge) to let sibling
                         container stacks reach MCP while web/api/postgres stay
                         on LASTRO_BIND. The port must differ from LASTRO_MCP_PORT.
  LASTRO_WEB_PORT / LASTRO_API_PORT / LASTRO_MCP_PORT / LASTRO_PG_PORT
  LASTRO_TAILSCALE_PORT       tailnet port for the dashboard (default: 8443)
  LASTRO_TAILSCALE_MCP_PORT   tailnet port for MCP (default: 8444)`;

/*
 * Operator mistakes (missing secret, Tailscale not logged in) are expected
 * outcomes, not crashes: print the message, not a stack trace.
 */
async function run(): Promise<void> {
  switch (command) {
    case "install":
      await install();
      break;
    case "stop":
      await stop();
      break;
    case "start":
      await start();
      break;
    case "ps":
      await $`container list`;
      break;
    case "logs": {
      const service = process.argv[3];
      const follow =
        process.argv.includes("--follow") || process.argv.includes("-f");
      if (!service) {
        console.error(usage);
        process.exit(1);
      }
      const name = service.startsWith(`${PREFIX}-`)
        ? service
        : `${PREFIX}-${service}`;
      if (follow) await $`container logs -f ${name}`;
      else await $`container logs ${name}`;
      break;
    }
    case "tailscale":
      // Publishing an already-running stack: the API was started with whatever
      // origin it had, so re-point it before serving or sign-in will fail.
      if (!(await exists(WEB))) {
        throw new Error(`${WEB} is not running; run install first`);
      }
      await serveOverTailscale();
      console.log(
        "\nIf the stack was installed without --tailscale, re-run install with it\n" +
          "so the API trusts this origin — Better Auth rejects sign-in otherwise.",
      );
      break;
    case "untailscale":
      await unserveTailscale();
      break;
    case "backup":
      await backup();
      break;
    case "restore":
      await restore();
      break;
    case "teardown":
      await teardown(process.argv.includes("--volumes"));
      break;
    default:
      console.error(usage);
      process.exit(1);
  }
}

try {
  await run();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
