/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { saleImporters } from "../parsers";
import { createSalesImports } from "./module";

describe("sales-imports", () => {
  test("registers its parsers and gives each an identity", async () => {
    const { api } = createSalesImports(saleImporters, {
      movements: {} as never,
    });
    expect(api.importers.get("yooga/sales").evidence).toBe("sale-movements");
    expect((await api.importers.identity("yooga/sales")).version).toBe(1);
  });
});
