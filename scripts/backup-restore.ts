#!/usr/bin/env bun
import { $ } from "bun";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";
const dumpPath = process.env.DUMP_PATH ?? "/tmp/lastro.dump";

const url = new URL(databaseUrl);
const host = url.hostname;
const port = url.port || "5432";
const user = url.username || "lastro";
const password = url.password || "lastro";
const db = url.pathname.slice(1) || "lastro";

const pgEnv = {
  PGHOST: host,
  PGPORT: port,
  PGUSER: user,
  PGPASSWORD: password,
  PGDATABASE: db,
};

const command = process.argv[2];

if (command === "backup") {
  await $`pg_dump -Fc -f ${dumpPath}`.env(pgEnv);
  console.log(`backup written to ${dumpPath}`);
} else if (command === "restore") {
  await $`pg_restore --clean --if-exists -d ${db} ${dumpPath}`.env(pgEnv);
  console.log(`restored from ${dumpPath}`);
} else {
  console.error("usage: bun scripts/backup-restore.ts <backup|restore>");
  process.exit(1);
}
