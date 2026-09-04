import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const secretPatterns = [
  /LASTRO_MCP_BEARER_TOKEN\s*=\s*[^\s]+/,
  /BARBACK_CLIENT_KEY\s*=\s*[^\s]+/,
  /BARBACK_ADMIN_KEY\s*=\s*[^\s]+/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
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
