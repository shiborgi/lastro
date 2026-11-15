/// <reference types="bun-types" />
import { afterAll, describe, expect, test } from "bun:test";
import {
  closeDb,
  createDb,
  manifests as hostManifests,
  moduleOrder,
} from "@lastro/host";
import { composeModules } from "@lastro/kernel";
import {
  type ModuleFacts,
  foreignKeyViolations,
  importViolations,
  kernelViolations,
  manifestViolations,
} from "./fitness/rules";
import {
  manifests,
  moduleFacts,
  packageDependencies,
  snapshotForeignKeys,
  sourceFiles,
  tableOwners,
} from "./fitness/tree";

describe("the module tree obeys ADR 11", () => {
  test("module imports", () => {
    expect(importViolations(sourceFiles("modules"), moduleFacts())).toEqual([]);
  });

  test("the kernel is pure", () => {
    const files = sourceFiles("packages/kernel/src");
    expect(files.length).toBeGreaterThan(0);
    expect(kernelViolations(files)).toEqual([]);
  });

  test("foreign keys follow module dependencies", async () => {
    const keys = snapshotForeignKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(
      foreignKeyViolations(keys, await tableOwners(), moduleFacts()),
    ).toEqual([]);
  });

  test("manifests, package dependencies and module order agree", async () => {
    const found = await manifests();
    expect(found.map((manifest) => manifest.id)).toContain("core");
    expect(
      manifestViolations(found, packageDependencies(), moduleOrder),
    ).toEqual([]);
  });
});

describe("every module but core is optional", () => {
  // Never connected: composing creates repositories, it runs no query.
  const db = createDb("postgres://lastro:lastro@127.0.0.1:1/unused");

  test.each(moduleOrder.filter((id) => id !== "core"))(
    "the host composes without %s and what depends on it",
    async (left) => {
      const out = new Set([left]);
      for (const manifest of hostManifests)
        if (manifest.dependsOn.some((dependency) => out.has(dependency)))
          out.add(manifest.id);
      const kept = hostManifests.filter((manifest) => !out.has(manifest.id));
      const host = composeModules({
        modules: kept,
        resources: { db },
        envelope: (modules) => (modules.core as { envelope: never }).envelope,
      });
      expect(Object.keys(host.modules)).toEqual(kept.map((each) => each.id));
      expect(
        host.operations.some((each) => each.id.startsWith(`${left}.`)),
      ).toBe(false);
    },
  );

  test("sales and finance do not depend on each other", () => {
    const of = (id: string) =>
      hostManifests.find((manifest) => manifest.id === id)?.dependsOn ?? [];
    expect(of("sales")).not.toContain("finance");
    expect(of("finance")).not.toContain("sales");
  });

  afterAll(() => closeDb(db));
});

/*
 * Each rule against a fixture that breaks it. If one of these stops failing
 * the way it says, the rule above it has stopped protecting anything.
 */
describe("the rules fail on what they forbid", () => {
  const modules: ModuleFacts[] = [
    { id: "core", dependencies: [] },
    { id: "finance", dependencies: ["core"] },
    { id: "sales", dependencies: ["finance", "core"] },
  ];
  const check = (path: string, source: string) =>
    importViolations([{ path, source }], modules);

  test.each([
    [
      "application code importing the ORM",
      "modules/finance/src/application/expenses.ts",
      'import { eq } from "drizzle-orm";',
      "application/ imports the database package drizzle-orm",
    ],
    [
      "domain code importing its own db folder",
      "modules/finance/src/domain/money.ts",
      'import { expenses } from "../db/schema";',
      "domain/ imports a db folder: ../db/schema",
    ],
    [
      "application code importing a dependency's db entry",
      "modules/finance/src/application/expenses.ts",
      'import { dbOf } from "@lastro/core/db";',
      "application/ imports a db folder: @lastro/core/db",
    ],
    [
      "a dependency in the wrong direction",
      "modules/finance/src/application/revenue.ts",
      'import { postSalesDay } from "@lastro/sales";',
      "imports @lastro/sales without depending on sales",
    ],
    [
      "a private path of another module",
      "modules/sales/src/application/day.ts",
      'import { x } from "@lastro/finance/src/application/receivables";',
      "imports a private path of finance",
    ],
    [
      "a relative import out of the module",
      "modules/sales/src/application/day.ts",
      'import { x } from "../../../finance/src/domain/receivables";',
      "relative import leaves the module",
    ],
    [
      "a testing entry used by production code",
      "modules/finance/src/application/expenses.ts",
      'import { memoryCore } from "@lastro/core/testing";',
      "only tests may import @lastro/core/testing",
    ],
    [
      "a legacy layer package",
      "modules/finance/src/application/expenses.ts",
      'import { money } from "@lastro/domain";',
      "which is neither kernel nor a module",
    ],
    [
      "contracts importing a server runtime module",
      "modules/core/src/contracts/index.ts",
      'import { randomUUID } from "node:crypto";',
      "contracts/ imports a server runtime module: node:crypto",
    ],
    [
      "contracts importing domain values",
      "modules/core/src/contracts/index.ts",
      'import { hashSecret } from "../domain/credentials";',
      "contracts/ may import domain types only",
    ],
    [
      "contracts importing application code",
      "modules/core/src/contracts/index.ts",
      'import type { CoreApi } from "../application/module";',
      "contracts/ imports application code",
    ],
    [
      "a module that is not listed",
      "modules/reports/src/application/x.ts",
      'import { z } from "zod";',
      "module reports is not listed",
    ],
  ])("%s", (_name, path, source, expected) => {
    const violations = check(path, source);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toContain(expected);
  });

  test("allowed imports stay allowed", () => {
    expect(
      [
        check(
          "modules/sales/src/application/day.ts",
          'import { recognize } from "@lastro/finance";\nimport type { Party } from "@lastro/finance/contracts";\nimport { money } from "@lastro/kernel";\nimport type { Day } from "../domain/day";',
        ),
        check(
          "modules/sales/src/db/repository.ts",
          'import { eq } from "drizzle-orm";\nimport { dbOf } from "@lastro/core/db";\nimport { accounts } from "@lastro/finance/db";',
        ),
        check(
          "modules/finance/src/application/expenses.test.ts",
          'import { memoryCore } from "@lastro/core/testing";',
        ),
        check(
          "modules/core/src/contracts/index.ts",
          'import type { Book } from "../domain/books";\nimport { z } from "zod";',
        ),
      ].flat(),
    ).toEqual([]);
  });

  test("the kernel importing a runtime or a module", () => {
    expect(
      kernelViolations([
        {
          path: "packages/kernel/src/money.ts",
          source:
            'import { randomUUID } from "node:crypto";\nimport { x } from "@lastro/core";',
        },
      ]),
    ).toEqual([
      "packages/kernel/src/money.ts: kernel imports node:crypto",
      "packages/kernel/src/money.ts: kernel imports @lastro/core",
    ]);
  });

  test("a foreign key against the dependency direction, or to an unowned table", () => {
    const owners = new Map([
      ["books", "core"],
      ["parties", "finance"],
      ["sales", "sales"],
    ]);
    expect(
      foreignKeyViolations(
        [
          { from: "parties", to: "books", name: "ok_fk" },
          { from: "sales", to: "parties", name: "ok_transitive_fk" },
          { from: "books", to: "parties", name: "books_sales_party_fk" },
          { from: "parties", to: "sales", name: "parties_sales_fk" },
          { from: "parties", to: "ghosts", name: "ghost_fk" },
        ],
        owners,
        modules,
      ),
    ).toEqual([
      "books_sales_party_fk: core.books references finance.parties, and core does not depend on finance",
      "parties_sales_fk: finance.parties references sales.sales, and finance does not depend on sales",
      "ghost_fk: table ghosts belongs to no module",
    ]);
  });

  test("a manifest that disagrees with its package or with the order", () => {
    expect(
      manifestViolations(
        [
          { id: "finance", dependsOn: ["core", "sales"] },
          { id: "reports", dependsOn: [] },
        ],
        new Map([["finance", ["core"]]]),
        ["core", "finance", "sales"],
      ),
    ).toEqual([
      "finance: dependsOn [core,sales] differs from package.json [core]",
      "finance: depends on sales, which is not before it in moduleOrder",
      "reports: missing from moduleOrder",
    ]);
  });
});
