/// <reference types="bun-types" />
/**
 * The yooga-payments flow over memory: a day's report taken into the till,
 * one record per payment method, each up to three revenues (gross, discount,
 * fee) once its component descriptors are filled (docs/flows/yooga-payments.md,
 * ADR 19).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FinanceApi } from "@lastro/finance";
import { financeTestHost } from "@lastro/finance/testing";
import { defineModule } from "@lastro/kernel";
import { financeImportsOperations } from "../contracts";
import { movementImporters } from "../parsers";
import { createFinanceImports } from "./module";

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dir, "../parsers/yooga-payments/fixtures", name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;
type Record_ = Row & { externalId: string; status: string; methodKey: string };
type RevenueLink = {
  component: string;
  externalKey: string;
  statementId: string;
  revenueKey: string;
  revenueId: string;
};

const TYPE = "revenue-movements";

async function book() {
  const { host, as } = financeTestHost([
    defineModule<null, { finance: FinanceApi }, unknown>({
      id: "finance-imports",
      dependsOn: ["core", "finance"],
      operations: financeImportsOperations,
      create: ({ modules }) =>
        createFinanceImports(movementImporters, modules.finance),
    }),
  ]);
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(id, as("editor"), input)) as T;
  const finance = <T = Row>(id: string, input: unknown) =>
    run<T>(`finance.${id}`, input);
  const till = await finance("createAccount", {
    key: "caixa",
    name: "Caixa",
    type: "CASH",
  });
  const customers = await finance("createParty", {
    key: "clientes",
    name: "Clientes",
    type: "COMPANY",
  });
  const sales = await finance("createFinancialCategory", {
    name: "Vendas",
    kind: "REVENUE",
  });
  const service = await finance("createFinancialCategory", {
    name: "Taxa de serviço",
    kind: "REVENUE",
  });
  const discounts = await finance("createFinancialCategory", {
    name: "Descontos concedidos",
    kind: "REVENUE",
    role: "DEDUCTION",
  });
  await run("finance-imports.setMovementConsumer", {
    accountId: till.id,
    type: TYPE,
    importerId: "yooga/payments",
  });
  const take = (name: string) =>
    run<Row & { new: number; posted: number; pending: number }>(
      "finance-imports.importMovements",
      {
        accountId: till.id,
        type: TYPE,
        key: `drive/yooga/pagamentos/${name}`,
        content: fixture(name),
      },
    );
  const classify = (descriptorKey: string, financialCategoryId: string) =>
    finance<{ posted: number }>("classifyRevenueMovementDescriptor", {
      accountId: till.id,
      descriptorKey,
      partyId: customers.id,
      financialCategoryId,
    });
  const records = async (query: Record<string, unknown> = {}) =>
    (await finance<{ items: Record_[] }>("listRevenueMovements", query)).items;
  const revenues = async (query: Record<string, unknown> = {}) =>
    (await finance<{ items: RevenueLink[] }>("listRevenueMovementLinks", query))
      .items;
  return {
    run,
    finance,
    take,
    classify,
    records,
    revenues,
    till,
    sales,
    service,
    discounts,
  };
}

describe("taking a Yooga payments report in", () => {
  test("one record per method, keyed by the hash of its line; replays write nothing", async () => {
    const { take, records, finance, till } = await book();
    expect(await take("day.csv")).toMatchObject({ new: 3, posted: 0 });
    expect(await take("day.csv")).toMatchObject({ alreadyImported: true });
    const pix = (await records()).find((each) => each.methodKey === "pix");
    // 145.55 paid = 134.95 gross − 2.00 discount + 12.60 fee
    expect(pix).toMatchObject({
      externalId: expect.stringMatching(/^[0-9a-f]{64}$/),
      gross: "13495",
      discount: "200",
      fee: "1260",
      amount: "14555",
    });
    const descriptors = await finance<{ items: Row[] }>(
      "listRevenueMovementDescriptors",
      { accountId: till.id },
    );
    // A component that is zero has no descriptor: Débito and Dinheiro have no discount.
    expect(descriptors.items.map((each) => each.descriptorKey).sort()).toEqual([
      "debito_bruto",
      "debito_taxa",
      "dinheiro_bruto",
      "dinheiro_taxa",
      "pix_bruto",
      "pix_desconto",
      "pix_taxa",
    ]);
  });

  test("a record whose gross, discount and fee do not add up to what was paid is refused", async () => {
    const { take, records } = await book();
    await expect(take("mismatch.csv")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(await records()).toEqual([]);
  });
});

describe("posting a record as its revenues", () => {
  test("a record posts once every component it carries is filled: gross, discount and fee", async () => {
    const {
      take,
      classify,
      records,
      revenues,
      finance,
      sales,
      service,
      discounts,
    } = await book();
    await take("day.csv");
    expect((await classify("pix_bruto", sales.id)).posted).toBe(0);
    expect((await classify("pix_desconto", discounts.id)).posted).toBe(0);
    expect((await classify("pix_taxa", service.id)).posted).toBe(1);

    const [pix] = await records({ methodKey: "pix" });
    expect(pix?.status).toBe("POSTED");
    // The record's external id is the hash of its line, and every link's external key.
    const external = String(pix?.externalId);
    const links = await revenues({ externalKey: external });
    expect(
      links.map((each) => `${each.component} ${each.revenueKey}`).sort(),
    ).toEqual([
      `DISCOUNT ${external}-desconto`,
      `FEE ${external}-taxa`,
      `GROSS ${external}-bruto`,
    ]);
    const all = await finance<{ items: Row[] }>("listRevenues", {});
    const byKey = new Map(all.items.map((each) => [each.key, each]));
    expect(byKey.get(`${external}-bruto`)).toMatchObject({ amount: "13495" });
    expect(byKey.get(`${external}-desconto`)).toMatchObject({
      amount: "-200",
      financialCategoryId: discounts.id,
    });
    expect(byKey.get(`${external}-taxa`)).toMatchObject({ amount: "1260" });
    // Each item has its own statement id, the hash of the record and its amount.
    const statementIds = links.map((each) => each.statementId);
    expect(new Set(statementIds).size).toBe(3);
    for (const id of statementIds) expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await revenues({ statementId: statementIds[0] })).toHaveLength(1);
    // One item is found by its own key, the group by the record's.
    expect(await revenues({ revenueKey: `${external}-taxa` })).toHaveLength(1);
  });

  test("a component refuses a category of the wrong kind", async () => {
    const { take, classify, sales, discounts } = await book();
    await take("day.csv");
    await expect(classify("pix_desconto", sales.id)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(classify("pix_bruto", discounts.id)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  test("later reports post on their own; undo keeps the revenues for the next post", async () => {
    const {
      take,
      classify,
      records,
      revenues,
      finance,
      sales,
      service,
      discounts,
    } = await book();
    await take("day.csv");
    await classify("pix_bruto", sales.id);
    await classify("pix_desconto", discounts.id);
    await classify("pix_taxa", service.id);
    // The next day's Pix has no discount: gross and fee only.
    expect(await take("next-day.csv")).toMatchObject({ new: 1, posted: 1 });
    const [next] = await records({ methodKey: "pix" });
    expect(await revenues({ movementId: next?.id })).toHaveLength(2);

    const before = (await finance<{ items: Row[] }>("listRevenues", {})).items
      .length;
    await finance("undoRevenueMovement", { id: next?.id });
    expect(await revenues({ movementId: next?.id })).toEqual([]);
    await finance("postRevenueMovement", { id: next?.id });
    expect(
      (await finance<{ items: Row[] }>("listRevenues", {})).items,
    ).toHaveLength(before);
  });
});
