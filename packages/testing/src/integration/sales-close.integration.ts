/// <reference types="bun-types" />
/* The derived daily close on the real database (ADR 21). */
import { afterAll, describe, expect, test } from "bun:test";
import { createHost } from "@lastro/host";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

type Row = { id: string } & Record<string, unknown>;
type Close = {
  sold: string;
  cost: string;
  fixedShare: string;
  result: string;
  provisional: boolean;
  missingCost: string[];
};

const HEADER =
  "codigo,produto,categoria,quantidade,custo,faturamento,lucro_bruto,margem_pct,data_inicio,data_fim";
const period = (day: string, next: string) => `${day} 06:00,${next} 06:00`;

async function bar() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(id, seeded.as("EDITOR"), input)) as T;
  const fixed = await run("finance.createFinancialCategory", {
    name: "Fixas",
    kind: "EXPENSE",
    role: "FIXED",
  });
  const landlord = await run("finance.createParty", {
    key: "landlord",
    name: "Landlord",
    type: "COMPANY",
  });
  const drinks = await run("sales.createProductCategory", {
    key: "drinks",
    name: "Bebidas",
  });
  const beer = await run("sales.createProduct", {
    key: "beer",
    name: "Beer",
    productCategoryId: drinks.id,
  });
  const wine = await run("sales.createProduct", {
    key: "wine",
    name: "Wine",
    productCategoryId: drinks.id,
  });
  await run("finance.createExpense", {
    key: "rent-oct",
    partyId: landlord.id,
    financialCategoryId: fixed.id,
    amount: "310000",
    currency: "BRL",
    referenceMonth: "2026-10-01",
  });
  await run("sales-imports.setSaleConsumer", {
    type: "sale-movements",
    importerId: "yooga/sales",
  });
  const take = (name: string, rows: string[]) =>
    run("sales-imports.importSales", {
      type: "sale-movements",
      key: name,
      content: [HEADER, ...rows].join("\n"),
    });
  await take("2026-10-30", [
    `1,Beer,Cerveja,10,40.00,100.00,60.00,60.00,${period("2026-10-30", "2026-10-31")}`,
    `2,Wine,Vinho,1,,20.00,20.00,100.00,${period("2026-10-30", "2026-10-31")}`,
  ]);
  await take("2026-10-31", [
    `1,Beer,Cerveja,1,4.00,10.00,6.00,60.00,${period("2026-10-31", "2026-11-01")}`,
  ]);
  await run("sales.classifySaleMovementDescriptor", {
    descriptorKey: "1",
    productId: beer.id,
  });
  await run("sales.classifySaleMovementDescriptor", {
    descriptorKey: "2",
    productId: wine.id,
  });
  const close = (businessDate: string) =>
    run<Close>("close.getDailyClose", { businessDate });
  return { run, close, wine };
}

describe("the daily close on PostgreSQL", () => {
  test("sold, cost and the October rent shared among the days with sales", async () => {
    const { run, close, wine } = await bar();
    expect(await close("2026-10-30")).toMatchObject({
      sold: "12000",
      cost: "4000",
      missingCost: [wine.id],
      // October has two days with sales and is closed: 310000 / 2.
      fixedShare: "155000",
      result: String(12000 - 4000 - 155000),
      provisional: false,
    });
    expect(
      await run("close.listDailyCloses", {
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toMatchObject({
      items: [{ businessDate: "2026-10-30" }, { businessDate: "2026-10-31" }],
    });
  });
});
