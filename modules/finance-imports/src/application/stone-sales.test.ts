/// <reference types="bun-types" />
/**
 * The stone-sales flow over memory (docs/flows/stone-sales.md, ADR 19): a
 * day's sales by product and brand become revenue movements whose gross is the
 * point of sale's and is not recognized again; only what Stone keeps becomes
 * a revenue, negative, under a DEDUCTION category.
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
    resolve(import.meta.dir, "../parsers/stone-sales/fixtures", name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;

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
  const stone = await finance("createAccount", {
    key: "stone",
    name: "Stone",
    type: "ACCOUNT",
  });
  const acquirer = await finance("createParty", {
    key: "stone",
    name: "Stone",
    type: "COMPANY",
  });
  const fees = await finance("createFinancialCategory", {
    name: "Taxas de adquirente",
    kind: "REVENUE",
    role: "DEDUCTION",
  });
  await run("finance-imports.setMovementConsumer", {
    accountId: stone.id,
    type: "revenue-movements",
    importerId: "stone/sales",
  });
  return { run, finance, stone, acquirer, fees };
}

describe("taking a Stone sales export in", () => {
  test("only the acquirer's fee is a revenue; the gross stays the point of sale's", async () => {
    const { run, finance, stone, acquirer, fees } = await book();
    expect(
      await run("finance-imports.importMovements", {
        accountId: stone.id,
        type: "revenue-movements",
        key: "drive/stone/vendas/november.csv",
        content: fixture("november.csv"),
      }),
    ).toMatchObject({ new: 3, posted: 0, pending: 3 });

    const descriptors = (
      await finance<{ items: Row[] }>("listRevenueMovementDescriptors", {
        accountId: stone.id,
      })
    ).items;
    // No gross descriptor: the gross is not recognized here.
    expect(descriptors.every((each) => each.component === "ACQUIRER_FEE")).toBe(
      true,
    );
    let posted = 0;
    for (const each of descriptors)
      posted += (
        await finance<{ posted: number }>("classifyRevenueMovementDescriptor", {
          accountId: stone.id,
          descriptorKey: each.descriptorKey,
          partyId: acquirer.id,
          financialCategoryId: fees.id,
        })
      ).posted;
    expect(posted).toBe(3);

    const records = (
      await finance<{ items: Row[] }>("listRevenueMovements", {
        accountId: stone.id,
      })
    ).items;
    const debit = records.find((each) => each.name === "Debito MasterCard");
    expect(debit).toMatchObject({
      gross: "7128",
      acquirerFee: "124",
      grossRecognized: false,
      amount: "7004",
      status: "POSTED",
    });
    const links = (
      await finance<{ items: Row[] }>("listRevenueMovementLinks", {
        movementId: debit?.id,
      })
    ).items;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ component: "ACQUIRER_FEE" });
    expect(String(links[0]?.revenueKey)).toEndWith("-taxa_adquirente");
  });

  test("a gross or fee category is not a DEDUCTION one for the acquirer's fee", async () => {
    const { run, finance, stone, acquirer } = await book();
    await run("finance-imports.importMovements", {
      accountId: stone.id,
      type: "revenue-movements",
      key: "drive/stone/vendas/november.csv",
      content: fixture("november.csv"),
    });
    const sales = await finance("createFinancialCategory", {
      name: "Vendas",
      kind: "REVENUE",
    });
    const [first] = (
      await finance<{ items: Row[] }>("listRevenueMovementDescriptors", {
        accountId: stone.id,
      })
    ).items;
    await expect(
      finance("classifyRevenueMovementDescriptor", {
        accountId: stone.id,
        descriptorKey: first?.descriptorKey,
        partyId: acquirer.id,
        financialCategoryId: sales.id,
      }),
    ).rejects.toThrow("DEDUCTION");
  });
});
