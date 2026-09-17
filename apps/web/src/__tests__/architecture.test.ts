import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const webRoot = join(import.meta.dir, "..", "..");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === "dist")
      continue;
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("web architecture boundaries", () => {
  const sourceFiles = collectSourceFiles(join(webRoot, "src"));

  test("React code has no dependency on database modules", () => {
    const offenders = sourceFiles.filter((file) => {
      const content = readFileSync(file, "utf8");
      return /@lastro\/db|@lastro\/domain/.test(content);
    });
    expect(offenders).toEqual([]);
  });

  test("React code invokes no domain mutation outside application-facing contracts", () => {
    const offenders = sourceFiles.filter((file) => {
      const content = readFileSync(file, "utf8");
      return (
        /@lastro\/domain/.test(content) &&
        /createExpense|createPayment|settle|void/.test(content)
      );
    });
    expect(offenders).toEqual([]);
  });
});
