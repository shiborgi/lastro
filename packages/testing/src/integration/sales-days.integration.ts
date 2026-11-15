/// <reference types="bun-types" />
/*
 * The yooga-sales flow on the real database (docs/flows/yooga-sales.md,
 * ADR 21): a day's report becomes sale movements, a descriptor names the
 * product of each code, its movements post as the day's lines, and a replay
 * writes nothing. No revenue is recognized.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHost } from "@lastro/host";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

const report = readFileSync(
  resolve(
    import.meta.dir,
    "../../../../modules/sales-imports/src/parsers/yooga-sales/fixtures/day.csv",
  ),
  "utf8",
);

type Row = { id: string } & Record<string, unknown>;

async function bar() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(id, seeded.as("EDITOR"), input)) as T;
  const drinks = await run("sales.createProductCategory", {
    key: "drinks",
    name: "Bebidas",
  });
  const beer = await run("sales.createProduct", {
    key: "beer",
    name: "Beer",
    productCategoryId: drinks.id,
  });
  await run("sales-imports.setSaleConsumer", {
    type: "sale-movements",
    importerId: "yooga/sales",
  });
  const take = () =>
    run<Row & { new: number; posted: number }>("sales-imports.importSales", {
      type: "sale-movements",
      key: "drive/yooga/vendas/vendas-20261101-periodo.csv",
      content: report,
    });
  return { run, take, beer };
}

describe("a Yooga sales day on PostgreSQL", () => {
  test("a classified code posts its movements as the day's lines; no revenue", async () => {
    const { run, take, beer } = await bar();
    expect(await take()).toMatchObject({ new: 3, posted: 0 });
    expect(
      (
        await run<{ posted: number }>("sales.classifySaleMovementDescriptor", {
          descriptorKey: "10931990",
          productId: beer.id,
        })
      ).posted,
    ).toBe(1);
    expect(
      await run("sales.getSalesDay", { businessDate: "2026-11-01" }),
    ).toMatchObject({ revenue: "162540", cost: "67940" });
    expect(await run("finance.listRevenues", {})).toMatchObject({ items: [] });
    expect(await take()).toMatchObject({ alreadyImported: true });
  });

  test("undo removes the line, and the day goes with its last line", async () => {
    const { run, take, beer } = await bar();
    await take();
    await run("sales.classifySaleMovementDescriptor", {
      descriptorKey: "10931990",
      productId: beer.id,
    });
    const [posted] = (
      await run<{ items: Row[] }>("sales.listSaleMovements", {
        status: "POSTED",
      })
    ).items;
    await run("sales.undoSaleMovement", { id: posted?.id });
    expect(await run<unknown>("sales.listSalesDays", {})).toEqual({
      items: [],
    });
  });
});
