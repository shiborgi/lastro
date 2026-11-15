/// <reference types="bun-types" />
/*
 * The web side of ADR 11: a module's screens reach only the shell, the UI
 * kit, app-wide helpers and the browser-safe contracts, and the shell knows
 * no module. Each rule is shown failing on a fixture first, because a
 * fitness rule that cannot fail protects nothing.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type SourceFile = { path: string; source: string };

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const importsOf = (source: string) =>
  [...source.matchAll(IMPORT)].map((match) => (match[1] ?? match[2]) as string);

/* What a module's screens may import besides their own folder. */
const ALLOWED_FOR_MODULES = [
  /^@\/shell\//,
  /^@\/components\/ui\//,
  /^@\/lib\//,
  /^@lastro\/kernel$/,
  /^@lastro\/[a-z-]+\/contracts$/,
];

/* Each web module's backend dependencies, from modules/<id>/package.json. */
type Dependencies = ReadonlyMap<string, readonly string[]>;

function violations(
  files: readonly SourceFile[],
  dependencies?: Dependencies,
): string[] {
  const found: string[] = [];
  for (const file of files) {
    const refuse = (specifier: string, reason: string) =>
      found.push(`${file.path}: ${specifier} (${reason})`);
    const inModule = /^src\/modules\/([^/]+)\//.exec(file.path)?.[1];
    const isRegistry = file.path === "src/modules/index.ts";
    const inShell = file.path.startsWith("src/shell/");
    const isTest = file.path.startsWith("src/__tests__/");
    if (isTest) continue;

    for (const specifier of importsOf(file.source)) {
      if (isRegistry) {
        if (
          !/^\.\/[a-z-]+\/module$/.test(specifier) &&
          !/^@\/shell\//.test(specifier)
        )
          refuse(
            specifier,
            "the registry only gathers each module's module.tsx",
          );
        continue;
      }
      if (inShell) {
        if (
          /^@\/modules(\/|$)/.test(specifier) ||
          /(^|\/)modules\//.test(specifier)
        )
          refuse(specifier, "the shell knows no module");
        if (
          /^@lastro\/(?!kernel$)[a-z-]+(\/(?!contracts$).*)?$/.test(specifier)
        )
          refuse(specifier, "the shell reaches modules only through contracts");
        continue;
      }
      if (!inModule) continue;
      if (specifier.startsWith(".")) {
        const depth = file.path.split("/").length - 4;
        const ups = specifier.split("/").filter((part) => part === "..").length;
        if (ups > depth)
          refuse(specifier, "a relative import leaves the module's folder");
        continue;
      }
      if (specifier.startsWith("@/") || specifier.startsWith("@lastro/")) {
        if (!ALLOWED_FOR_MODULES.some((rule) => rule.test(specifier)))
          refuse(
            specifier,
            "a module reaches only the shell, components/ui, lib, the kernel and contracts",
          );
        const target = /^@lastro\/([a-z-]+)\/contracts$/.exec(specifier)?.[1];
        if (target && dependencies) {
          const own = dependencies.get(inModule);
          if (!own)
            refuse(specifier, `src/modules/${inModule} has no backend module`);
          else if (target !== inModule && !own.includes(target))
            refuse(
              specifier,
              `${inModule} does not depend on ${target}; its screens use only its own and its dependencies' contracts`,
            );
        }
      }
    }
  }
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const webRoot = join(import.meta.dir, "..", "..");
const repoRoot = join(webRoot, "..", "..");

function backendDependencies(): Dependencies {
  const found = new Map<string, string[]>();
  for (const id of readdirSync(join(repoRoot, "modules"))) {
    const manifest = join(repoRoot, "modules", id, "package.json");
    try {
      const { dependencies = {} } = JSON.parse(readFileSync(manifest, "utf8"));
      found.set(
        id,
        Object.keys(dependencies)
          .filter((name) => name.startsWith("@lastro/"))
          .map((name) => name.slice("@lastro/".length)),
      );
    } catch {
      // Not a module folder.
    }
  }
  return found;
}

describe("web modules obey ADR 11", () => {
  test("the real tree", () => {
    const files = ["src/modules", "src/shell"].flatMap((dir) =>
      walk(join(webRoot, dir)).map((path) => ({
        path: relative(webRoot, path),
        source: readFileSync(path, "utf8"),
      })),
    );
    expect(
      files.some((file) => file.path.startsWith("src/modules/finance/")),
    ).toBe(true);
    expect(violations(files, backendDependencies())).toEqual([]);
  });
});

describe("the rules fail on what they forbid", () => {
  const check = (path: string, source: string) =>
    violations([{ path, source }]);

  test.each([
    [
      "another module's folder",
      "src/modules/sales/days.tsx",
      'import { x } from "@/modules/finance/shared";',
      "a module reaches only",
    ],
    [
      "a relative path into another module",
      "src/modules/sales/days.tsx",
      'import { x } from "../finance/receivables";',
      "leaves the module's folder",
    ],
    [
      "an old component",
      "src/modules/sales/days.tsx",
      'import { PostTab } from "@/components/post-tab";',
      "a module reaches only",
    ],
    [
      "a module's server code",
      "src/modules/sales/days.tsx",
      'import { createSales } from "@lastro/sales";',
      "a module reaches only",
    ],
    [
      "a module's db entry",
      "src/modules/finance/expenses.tsx",
      'import { expenses } from "@lastro/finance/db";',
      "a module reaches only",
    ],
    [
      "a module's testing entry",
      "src/modules/finance/expenses.tsx",
      'import { x } from "@lastro/finance/testing";',
      "a module reaches only",
    ],
    [
      "the old layer packages",
      "src/modules/finance/expenses.tsx",
      'import { Amount } from "@lastro/contracts";',
      "a module reaches only",
    ],
    [
      "the shell importing a module",
      "src/shell/shell.tsx",
      'import { financeWebModule } from "@/modules/finance/module";',
      "the shell knows no module",
    ],
    [
      "the shell reaching a module's server code",
      "src/shell/client.ts",
      'import { createHost } from "@lastro/host";',
      "only through contracts",
    ],
    [
      "the registry importing a screen",
      "src/modules/index.ts",
      'import { ExpensesScreen } from "./finance/expenses";',
      "only gathers",
    ],
  ])("refuses %s", (_name, path, source, expected) => {
    const found = check(path, source);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join("\n")).toContain(expected);
  });

  test("refuses another module's contracts it does not depend on", () => {
    const deps = new Map([
      ["finance", ["kernel", "core"]],
      ["finance-imports", ["kernel", "core", "finance"]],
    ]);
    const source = (specifier: string) => `import { x } from "${specifier}";`;
    expect(
      violations(
        [
          {
            path: "src/modules/finance/account-movements.tsx",
            source: source("@lastro/finance-imports/contracts"),
          },
        ],
        deps,
      ).join("\n"),
    ).toContain("finance does not depend on finance-imports");
    expect(
      violations(
        [
          {
            path: "src/modules/finance-imports/imports.tsx",
            source: source("@lastro/finance/contracts"),
          },
        ],
        deps,
      ),
    ).toEqual([]);
    expect(
      violations(
        [
          {
            path: "src/modules/ghost/x.tsx",
            source: source("@lastro/finance/contracts"),
          },
        ],
        deps,
      ).join("\n"),
    ).toContain("has no backend module");
  });

  test("allowed imports stay allowed", () => {
    expect(
      [
        check(
          "src/modules/sales/days.tsx",
          [
            'import { accounts } from "@lastro/finance/contracts";',
            'import type { OperationDescriptor } from "@lastro/kernel";',
            'import { Button } from "@/components/ui/button";',
            'import { formatStatementAmount } from "@/lib/money";',
            'import { call } from "@/shell/client";',
            'import { PRODUCTS } from "./catalogs";',
            'import { useState } from "react";',
          ].join("\n"),
        ),
        check(
          "src/modules/index.ts",
          'import type { WebModule } from "@/shell/registry";\nimport { salesWebModule } from "./sales/module";',
        ),
        check(
          "src/shell/shell.tsx",
          'import { coreOperations } from "@lastro/core/contracts";\nimport { SignIn } from "@/components/sign-in";',
        ),
      ].flat(),
    ).toEqual([]);
  });
});
