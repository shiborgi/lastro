import { readFileSync } from "node:fs";

const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");

const currentSection = notices.match(/## Current([\s\S]*?)(?=## |$)/)?.[1] ?? "";

const hasCopiedMarker = /Copied components:/.test(currentSection);
const noComponents = /No components copied/.test(currentSection);

const entries = currentSection
  .split(/\n\s*-\s+/)
  .slice(1)
  .map((entry) => entry.trim())
  .filter(Boolean);

let failed = false;

function requireField(entry: string, field: string, label: string) {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = entry.match(pattern);
  if (!match || !match[1].trim()) {
    console.error(`  missing ${label} in entry: ${entry.split("\n")[0]}`);
    failed = true;
  }
  return match?.[1]?.trim();
}

console.log("THIRD_PARTY_NOTICES check");

if (noComponents) {
  console.log("  copied components: []");
  console.log("  empty list is acceptable for foundation");
} else if (hasCopiedMarker) {
  console.log(`  copied components: ${entries.length} entry(ies)`);
  for (const entry of entries) {
    const project = requireField(entry, "Project", "project");
    const license = requireField(entry, "License", "license");
    const revision = requireField(entry, "Source revision", "source revision");
    const components = requireField(entry, "Copied components", "copied components");
    if (project && license && revision && components) {
      console.log(`  - ${project} (${license}) @ ${revision}: ${components}`);
    }
  }
} else {
  console.error("  THIRD_PARTY_NOTICES.md has no '## Current' section with a component list");
  failed = true;
}

if (failed) {
  console.error("THIRD_PARTY_NOTICES check failed: a copied component lacks a recorded entry");
  process.exit(1);
}

process.exit(0);
