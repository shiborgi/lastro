#!/usr/bin/env bun
import { $ } from "bun";

const composeFile =
  process.env.COMPOSE_FILE ?? "docker-compose.release.yml";
const dumpPath = process.env.DUMP_PATH ?? "/tmp/lastro.dump";
const command = process.argv[2];

if (command === "backup") {
  await $`docker compose -f ${composeFile} exec -T postgres pg_dump -U lastro -d lastro -Fc > ${dumpPath}`;
  console.log(`backup written to ${dumpPath}`);
} else if (command === "restore") {
  await $`docker compose -f ${composeFile} exec -T postgres pg_restore -U lastro -d lastro --clean --if-exists < ${dumpPath}`;
  console.log(`restored from ${dumpPath}`);
} else {
  console.error("usage: bun scripts/backup-restore.ts <backup|restore>");
  process.exit(1);
}
