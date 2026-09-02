/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

const PACKAGES = [
  "@lastro/domain",
  "@lastro/application",
  "@lastro/db",
  "@lastro/contracts",
  "@lastro/auth",
  "@lastro/banking",
  "@lastro/ui",
  "@lastro/observability",
  "@lastro/config",
  "@lastro/testing",
];

function getPackageDeps(name: string): string[] {
  const pkgPath = resolve(
    ROOT,
    "packages",
    name.replace("@lastro/", ""),
    "package.json",
  );
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    return Object.keys(deps).filter((d) => PACKAGES.includes(d));
  } catch {
    return [];
  }
}

function hasCycle(): boolean {
  const graph = new Map<string, string[]>();
  for (const p of PACKAGES) {
    graph.set(p, getPackageDeps(p));
  }
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const nei of graph.get(node) || []) {
      if (dfs(nei)) return true;
    }
    stack.delete(node);
    return false;
  }

  for (const p of PACKAGES) {
    if (dfs(p)) return true;
  }
  return false;
}

describe("package graph", () => {
  test("has no runtime dependency cycles", () => {
    expect(hasCycle()).toBe(false);
  });
});
