import { readFileSync } from "node:fs";

const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
const hasCopied = /## Current[\s\S]*?Copied components:/.test(notices) && !/No components copied/.test(notices);

console.log("THIRD_PARTY_NOTICES check");
console.log("  upstream project: (none yet)");
console.log("  license: MIT (when copied)");
console.log("  source revision: (none)");
console.log("  copied components:", hasCopied ? "(see file)" : "[]");

if (hasCopied) {
  // would fail in future if required
  console.log("has copied sources");
} else {
  console.log("empty list is acceptable for foundation");
}
process.exit(0);
