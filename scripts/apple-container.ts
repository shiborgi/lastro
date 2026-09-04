#!/usr/bin/env bun
import { $ } from "bun";

const IMAGE = process.env.LASTRO_IMAGE ?? "lastro:release";
const NETWORK = "lastro";
const VOLUME = "lastro_pgdata";
const DUMP_PATH = process.env.DUMP_PATH ?? "/tmp/lastro.dump";
const REMOTE_DUMP_PATH = "/tmp/lastro.dump";

const dbPassword = process.env.LASTRO_DB_PASSWORD ?? "lastro";
const apiToken = process.env.LASTRO_API_TOKEN ?? "";
const apiUrl = process.env.LASTRO_API_URL ?? "http://api:3001";
const databaseUrl = `postgres://lastro:${dbPassword}@postgres:5432/lastro`;

const CONTAINERS = [
  "lastro-postgres",
  "lastro-api",
  "lastro-mcp",
  "lastro-worker",
  "lastro-web",
];

const command = process.argv[2];

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
  const result =
    await $`container exec lastro-postgres pg_isready -U lastro -d lastro`
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
  const pgIp = await containerIp("lastro-postgres");
  const apiIp = await containerIp("lastro-api");
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

async function install(): Promise<void> {
  await $`container system start`.nothrow().quiet();
  await $`container builder start`.nothrow().quiet();
  await $`container network create ${NETWORK}`.nothrow().quiet();
  await $`container volume create ${VOLUME}`.nothrow().quiet();

  console.log(`building image ${IMAGE}...`);
  await $`container build -t ${IMAGE} -f Dockerfile .`;

  for (const name of CONTAINERS) await removeIfExists(name);

  console.log("starting postgres...");
  await $`container run -d --name lastro-postgres --network ${NETWORK} -e POSTGRES_USER=lastro -e POSTGRES_PASSWORD=${dbPassword} -e POSTGRES_DB=lastro -e PGDATA=/var/lib/postgresql/data/pgdata -v ${VOLUME}:/var/lib/postgresql/data -p 5432:5432 postgres:16-alpine`;
  await waitFor("postgres", pgReady, 120_000);

  console.log("running migrations...");
  // The one-off migrate container is created before the hosts sync, so it
  // gets the freshly resolved postgres IP directly (no restart concern).
  const pgIp = await containerIp("lastro-postgres");
  const migrateUrl = `postgres://lastro:${dbPassword}@${pgIp}:5432/lastro`;
  await $`container run --rm --name lastro-migrate --network ${NETWORK} -e DATABASE_URL=${migrateUrl} ${IMAGE} bun packages/db/src/migrate.ts`;

  console.log("starting services...");
  await $`container run -d --name lastro-api --network ${NETWORK} -e DATABASE_URL=${databaseUrl} -e HOST=0.0.0.0 -e PORT=3001 -p 3001:3001 ${IMAGE} bun apps/api/src/index.ts`;
  await $`container run -d --name lastro-mcp --network ${NETWORK} -e DATABASE_URL=${databaseUrl} -e HOST=0.0.0.0 -e PORT=3002 -p 3002:3002 ${IMAGE} bun apps/mcp/src/index.ts`;
  await $`container run -d --name lastro-worker --network ${NETWORK} -e DATABASE_URL=${databaseUrl} ${IMAGE} bun apps/worker/src/run.ts`;
  await $`container run -d --name lastro-web --network ${NETWORK} -w /app/apps/web -e LASTRO_API_URL=${apiUrl} -e LASTRO_API_TOKEN=${apiToken} -p 3000:3000 ${IMAGE} bun run start`;

  console.log("syncing container hostnames...");
  await syncHosts();

  console.log("waiting for health...");
  await waitFor(
    "api health",
    () => httpOk("http://127.0.0.1:3001/health"),
    120_000,
  );
  await waitFor(
    "mcp health",
    () => httpOk("http://127.0.0.1:3002/health"),
    120_000,
  );
  await waitFor("web", () => httpOk("http://127.0.0.1:3000/"), 180_000);
  for (const name of CONTAINERS) {
    const state = await containerState(name);
    if (state !== "running") throw new Error(`${name} is ${state}`);
  }
  console.log("install complete: api :3001, mcp :3002, web :3000");
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

async function teardown(withVolumes: boolean): Promise<void> {
  await stop();
  for (const name of CONTAINERS) await removeIfExists(name);
  await $`container network rm ${NETWORK}`.nothrow().quiet();
  if (withVolumes) {
    await $`container volume rm ${VOLUME}`.nothrow().quiet();
    console.log("teardown complete (data removed)");
  } else {
    console.log("teardown complete (data kept)");
  }
}

async function backup(): Promise<void> {
  await $`container exec lastro-postgres pg_dump -U lastro -d lastro -Fc -f ${REMOTE_DUMP_PATH}`;
  await $`container cp lastro-postgres:${REMOTE_DUMP_PATH} ${DUMP_PATH}`;
  console.log(`backup written to ${DUMP_PATH}`);
}

async function restore(): Promise<void> {
  await $`container cp ${DUMP_PATH} lastro-postgres:${REMOTE_DUMP_PATH}`;
  await $`container exec lastro-postgres pg_restore -U lastro -d lastro --clean --if-exists ${REMOTE_DUMP_PATH}`;
  console.log(`restored from ${DUMP_PATH}`);
}

const usage = `usage: bun scripts/apple-container.ts <install|stop|start|ps|logs|backup|restore|teardown>
  logs <service> [--follow]   show logs for lastro-<service> (api|mcp|worker|web|postgres)
  teardown [--volumes]        remove containers (and data with --volumes)`;

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
    const name = service.startsWith("lastro-") ? service : `lastro-${service}`;
    if (follow) await $`container logs -f ${name}`;
    else await $`container logs ${name}`;
    break;
  }
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
