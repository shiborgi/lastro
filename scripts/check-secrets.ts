import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

const scanned = /\.(ts|tsx|js|json|yaml|yml|env|md|toml)$/;

/*
 * Tracked files only, which is what the failure message has always claimed.
 * Walking the working tree instead meant a developer's own `.env` — gitignored
 * and never pushed — failed `bun run check` on every machine that had one, and
 * an alarm that fires on every run is an alarm that gets switched off. Asking
 * git is also stricter: it sees a tracked file in a directory a hand-written
 * ignore list would have skipped.
 */
function trackedFiles(): string[] {
  const listing = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing
    .split("\0")
    .filter((name) => name !== "" && scanned.test(name))
    .map((name) => join(root, name))
    .filter((path) => existsSync(path));
}

let failed = false;

console.log("SECRET SCAN");
for (const file of trackedFiles()) {
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
