/// <reference types="bun-types" />
/**
 * The stone-payouts flow over memory (docs/flows/stone-payouts.md, ADR 20):
 * Stone's deposits are promises, receipt movements of the C6 account posted
 * as expected receipts; the C6 statement's line for the same money, with the
 * same statement key, pays that receipt.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FinanceApi } from "@lastro/finance";
import { accountMovementSides, financeTestHost } from "@lastro/finance/testing";
import { defineModule } from "@lastro/kernel";
import { financeImportsOperations } from "../contracts";
import { movementImporters } from "../parsers";
import { createFinanceImports } from "./module";

const fixture = (flow: string, name: string) =>
  readFileSync(
    resolve(import.meta.dir, `../parsers/${flow}/fixtures`, name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;

const DEBIT = "202601070000000000001";

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
  const sides = accountMovementSides(run);
  const c6 = await finance("createAccount", {
    key: "c6",
    name: "C6",
    type: "ACCOUNT",
  });
  const stone = await finance("createParty", {
    key: "stone",
    name: "Stone",
    type: "COMPANY",
  });
  const cards = await finance("createFinancialCategory", {
    name: "Vendas em cartão",
    kind: "REVENUE",
  });
  for (const [type, importerId] of [
    ["account-movements", "c6/account"],
    ["receipt-movements", "stone/payouts"],
  ] as const)
    await run("finance-imports.setMovementConsumer", {
      accountId: c6.id,
      type,
      importerId,
    });
  const take = (type: string, flow: string) =>
    run<Row & { new: number; posted: number }>(
      "finance-imports.importMovements",
      {
        accountId: c6.id,
        type,
        key: `drive/${flow}/month.csv`,
        content: fixture(flow, "month.csv"),
      },
    );
  const takePayouts = () => take("receipt-movements", "stone-payouts");
  const takeC6 = () => take("account-movements", "c6-account");
  const movements = async () =>
    (
      await sides.list<{ items: Row[] }>({
        accountId: c6.id,
        direction: "RECEIPT",
      })
    ).items;
  // Every Stone name, on either side, posts as Stone by transfer.
  const classifyStone = async () => {
    const descriptors = (
      await sides.descriptors<{ items: Row[] }>({
        accountId: c6.id,
        direction: "RECEIPT",
      })
    ).items;
    for (const each of descriptors)
      await sides.classify({
        accountId: c6.id,
        direction: "RECEIPT",
        descriptorKey: each.descriptorKey,
        partyId: stone.id,
        financialCategoryId: cards.id,
        paymentMethod: "TRANSFER",
      });
  };
  const linkOf = async (movement: Row | undefined) =>
    (
      await sides.links<{ items: Row[] }>({
        movementId: movement?.id,
      })
    ).items[0];
  const receipt = async (id: unknown) =>
    (await finance<{ receipt: Row }>("getReceipt", { id })).receipt;
  const c6Debit = (all: Row[]) =>
    all.find((each) => each.amount === "93703" && each.externalId !== DEBIT);
  const stoneDebit = (all: Row[]) =>
    all.find((each) => each.externalId === DEBIT);
  return {
    finance,
    sides,
    takePayouts,
    takeC6,
    movements,
    classifyStone,
    linkOf,
    receipt,
    c6Debit,
    stoneDebit,
  };
}

describe("taking Stone's payouts into the C6 account", () => {
  test("every deposit, paid or scheduled, is a promise of the C6 account, keyed by Stone's id", async () => {
    const { takePayouts, movements } = await book();
    expect(await takePayouts()).toMatchObject({ new: 4, posted: 0 });
    const all = await movements();
    expect(all.every((each) => each.promise === true)).toBe(true);
  });

  test("the promise posts an expected receipt; the C6 line pays the same receipt", async () => {
    const t = await book();
    await t.takePayouts();
    await t.classifyStone();
    const promised = await t.linkOf(t.stoneDebit(await t.movements()));
    expect(await t.receipt(promised?.receiptId)).toMatchObject({
      amount: "93703",
      dueOn: "2026-01-07",
      paidOn: null,
    });

    await t.takeC6();
    await t.classifyStone();
    const kept = await t.linkOf(t.c6Debit(await t.movements()));
    expect(kept?.statementKey).toBe(promised?.statementKey);
    expect(kept?.receiptId).toBe(promised?.receiptId);
    expect(await t.receipt(promised?.receiptId)).toMatchObject({
      amount: "93703",
      paidOn: "2026-01-07",
    });
  });

  test("a C6 line first is received at once; the promise then joins it", async () => {
    const t = await book();
    await t.takeC6();
    await t.takePayouts();
    await t.classifyStone();
    const all = await t.movements();
    const c6Link = await t.linkOf(t.c6Debit(all));
    const stoneLink = await t.linkOf(t.stoneDebit(all));
    expect(stoneLink?.receiptId).toBe(c6Link?.receiptId);
    expect(await t.receipt(c6Link?.receiptId)).toMatchObject({
      paidOn: "2026-01-07",
    });
  });

  test("undoing the C6 line leaves the promise expected; undoing the promise keeps the money", async () => {
    const t = await book();
    await t.takePayouts();
    await t.takeC6();
    await t.classifyStone();
    const all = await t.movements();
    const link = await t.linkOf(t.stoneDebit(all));

    await t.sides.undo({ id: t.c6Debit(all)?.id });
    expect(await t.receipt(link?.receiptId)).toMatchObject({
      amount: "93703",
      paidOn: null,
    });
  });
});
