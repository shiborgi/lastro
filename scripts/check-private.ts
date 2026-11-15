#!/usr/bin/env bun
/*
 * Keeps an operator's private data out of the repository. The tokens (a
 * business name, account numbers, a host name) are listed one per line in a
 * file outside the repository, named by LASTRO_PRIVATE_TOKENS (default
 * ~/.config/lastro/private-tokens). Without that file there is nothing to
 * check, so the scan passes: a fresh clone or CI has no private data.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const path =
  process.env.LASTRO_PRIVATE_TOKENS ??
  join(homedir(), ".config", "lastro", "private-tokens");

if (!existsSync(path)) {
  console.log("PRIVATE DATA SCAN\n  no token list; nothing to check");
  process.exit(0);
}

const tokens = readFileSync(path, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const found: string[] = [];
for (const token of tokens) {
  const result =
    await $`git grep -nIi --fixed-strings -e ${token} -- . ${":!bun.lock"}`
      .nothrow()
      .quiet();
  const lines = result.stdout.toString().trim();
  if (lines) found.push(...lines.split("\n"));
}

console.log("PRIVATE DATA SCAN");
if (found.length === 0) {
  console.log(`  none of the ${tokens.length} private tokens is tracked`);
  process.exit(0);
}
// Name the place, never echo the token itself.
for (const line of found)
  console.log(`  ${line.split(":").slice(0, 2).join(":")}`);
console.error(`  ${found.length} tracked line(s) carry private data`);
process.exit(1);
