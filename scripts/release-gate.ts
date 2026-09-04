#!/usr/bin/env bun
import { $ } from "bun";

console.log("RELEASE GATE");
console.log("  running bun install --frozen-lockfile && bun run check ...");
await $`bun install --frozen-lockfile && bun run check`.cwd(process.cwd());
console.log("  check passed");

console.log("  running bun run test:integration ...");
await $`bun run test:integration`.cwd(process.cwd());
console.log("  integration passed");

console.log("RELEASE GATE PASSED");
