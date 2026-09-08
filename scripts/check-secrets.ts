import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/*
 * A committed credential looks like `NAME=<literal>`. A template that prints
 * one (`NAME=${token}`), an env lookup, an empty assignment in .env.example and
 * a documentation placeholder (`NAME=<paste-here>`) are all legitimate and must
 * not trip the scan — an alarm that cries wolf gets switched off.
 */
const CREDENTIAL_NAMES = [
  "MCP_BEARER_TOKEN",
  "LASTRO_API_TOKEN",
  "LASTRO_DB_PASSWORD",
  "BETTER_AUTH_SECRET",
];

const literalAssignment = new RegExp(
  `\\b(?:${CREDENTIAL_NAMES.join("|")})\\s*=\\s*(?!\\s|$|\\$\\{|<|"?\\s*\\+|process\\.env|["']?\\s*$)["']?([A-Za-z0-9._~+/=-]{8,})`,
);

const secretPatterns = [
  literalAssignment,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /\bpostgres(?:ql)?:\/\/[^\s:@/]+:(?!lastro@|password@|\$\{)[^\s:@/]{6,}@/,
];

const ignoredDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "test-results",
  "playwright-report",
]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx|js|json|yaml|yml|env|md|toml)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

let failed = false;

console.log("SECRET SCAN");
for (const file of walk(root)) {
  const content = readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      console.error(`  secret-like value found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("SECRET SCAN FAILED: a credential-like value is committed");
  process.exit(1);
}

console.log("  no committed credentials found");
process.exit(0);
