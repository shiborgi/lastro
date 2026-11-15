/// <reference types="bun-types" />
/**
 * The yooga-sales flow over memory (docs/flows/yooga-sales.md, ADR 21): a
 * day's products become sale movements; a descriptor names the product of
 * each code, and its movements post as sale lines of the day.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineModule } from "@lastro/kernel";
import type { SalesApi } from "@lastro/sales";
import { salesTestHost } from "@lastro/sales/testing";
import { salesImportsOperations } from "../contracts";
import { saleImporters } from "../parsers";
import { createSalesImports } from "./module";

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dir, "../parsers/yooga-sales/fixtures", name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;

async function bar() {
  const { host, as } = salesTestHost(undefined, [
    defineModule<null, { sales: SalesApi }, unknown>({
      id: "sales-imports",
      dependsOn: ["core", "sales"],
      operations: salesImportsOperations,
      create: ({ modules }) => createSalesImports(saleImporters, modules.sales),
    }),
  ]);
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(id, as("editor"), input)) as T;
  const drinks = await run("sales.createProductCategory", {
    key: "cerveja",
    name: "Cerveja",
  });
  const beer = await run("sales.createProduct", {
    key: "original-600",
    name: "Original 600ml",
    productCategoryId: drinks.id,
  });
  const water = await run("sales.createProduct", {
    key: "agua",
    name: "Água",
    productCategoryId: drinks.id,
    costOverride: "150",
  });
  await run("sales-imports.setSaleConsumer", {
    type: "sale-movements",
    importerId: "yooga/sales",
  });
  const take = () =>
    run<Row & { new: number; posted: number; pending: number }>(
      "sales-imports.importSales",
      {
        type: "sale-movements",
        key: "drive/yooga/vendas/vendas-20261101-periodo.csv",
        content: fixture("day.csv"),
      },
    );
  const classify = (descriptorKey: string, productId: string) =>
    run<{ posted: number }>("sales.classifySaleMovementDescriptor", {
      descriptorKey,
      productId,
    });
  return { run, take, classify, beer, water };
}

describe("taking a Yooga sales report in", () => {
  test("one movement per product, pending until its code names a product; replays write nothing", async () => {
    const { run, take } = await bar();
    expect(await take()).toMatchObject({ new: 3, posted: 0, pending: 3 });
    expect(await take()).toMatchObject({ alreadyImported: true });
    const descriptors = (
      await run<{ items: Row[] }>("sales.listSaleMovementDescriptors", {
        classified: "false",
      })
    ).items;
    expect(descriptors.map((each) => each.descriptorKey).sort()).toEqual([
      "10931982",
      "10931990",
      "2714403",
    ]);
    await expect(
      run("sales.getSalesDay", { businessDate: "2026-11-01" }),
    ).rejects.toThrow("no posted sale lines");
  });

  test("classifying a code posts its movements as lines, with the cost each carries", async () => {
    const { run, take, classify, beer, water } = await bar();
    await take();
    expect((await classify("10931990", beer.id)).posted).toBe(1);
    expect((await classify("10931982", water.id)).posted).toBe(1);
    const day = await run<{
      revenue: string;
      cost: string;
      lines: { productId: string; costSource: string; cost: string | null }[];
    }>("sales.getSalesDay", { businessDate: "2026-11-01" });
    expect(day).toMatchObject({ revenue: "182540", cost: "73940" });
    expect(day.lines.map((line) => [line.costSource, line.cost])).toEqual([
      ["SALE", "67940"],
      // The catalog's 1.50 a unit wins over the reported 52.00 for 40.
      ["CATALOG", "6000"],
    ]);
    const [beerMovement] = (
      await run<{ items: Row[] }>("sales.listSaleMovements", {
        descriptorKey: "10931990",
      })
    ).items;
    const links = (
      await run<{ items: Row[] }>("sales.listSaleMovementLinks", {
        externalKey: beerMovement?.externalId,
      })
    ).items;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      movementId: beerMovement?.id,
      saleKey: `${beerMovement?.externalId}-sale`,
    });
    const pending = (
      await run<{ items: Row[] }>("sales.listSaleMovements", {
        status: "PENDING",
      })
    ).items;
    expect(pending.map((each) => each.code)).toEqual(["2714403"]);
  });

  test("ignore and undo move a movement out of and back into review", async () => {
    const { run, take, classify, beer } = await bar();
    await take();
    await classify("10931990", beer.id);
    const [posted] = (
      await run<{ items: Row[] }>("sales.listSaleMovements", {
        status: "POSTED",
      })
    ).items;
    await run("sales.undoSaleMovement", { id: posted?.id });
    await expect(
      run("sales.getSalesDay", { businessDate: "2026-11-01" }),
    ).rejects.toThrow("no posted sale lines");
    expect(
      await run("sales.ignoreSaleMovement", {
        id: posted?.id,
        reason: "cortesia",
      }),
    ).toMatchObject({ status: "IGNORED", ignoreReason: "cortesia" });
  });

  test("a type with no consumer is refused before anything is read", async () => {
    const { run } = await bar();
    await expect(
      run("sales-imports.importSales", {
        type: "other-report",
        key: "x",
        content: "x",
      }),
    ).rejects.toThrow("no consumer");
  });
});
