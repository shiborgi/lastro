/// <reference types="bun-types" />
/**
 * A sales parser from another package (ADR 11): contributed by a module that
 * depends on sales-imports, listed and routed like the examples.
 */
import { describe, expect, test } from "bun:test";
import { type ModuleDefinition, defineModule } from "@lastro/kernel";
import { salesTestHost } from "@lastro/sales/testing";
import { salesImportsModule } from "..";
import type { SaleImporter } from "./importer";

const examplePos: SaleImporter = {
  id: "example/pos",
  version: 1,
  evidence: "sale-movements",
  parse: () => [],
};

const contributor = (importer: unknown) =>
  defineModule<null, object, object>({
    id: "example-pos-imports",
    dependsOn: ["core", "sales", "sales-imports"],
    operations: [],
    contributes: { "sales-imports": [importer] },
    create: () => ({ api: {}, handlers: [] }),
  });

const host = (extra: ModuleDefinition<null>) =>
  salesTestHost(undefined, [
    salesImportsModule as unknown as ModuleDefinition<null>,
    extra,
  ]);

describe("contributed sales importers", () => {
  test("are listed and can be set as the Book's consumer", async () => {
    const { host: lastro, as } = host(contributor(examplePos));
    const run = (id: string, input: unknown) =>
      lastro.execute(id, as("editor"), input);
    const listed = (await run("sales-imports.listSaleImporters", {})) as {
      items: { id: string }[];
    };
    expect(listed.items.map((each) => each.id)).toContain("example/pos");
    await run("sales-imports.setSaleConsumer", {
      type: "sale-movements",
      importerId: "example/pos",
    });
  });

  test("refuse an item that is not an importer, at start-up", () => {
    expect(() => host(contributor({ id: "broken" }))).toThrow(
      "contributed sales importer broken needs",
    );
  });
});
