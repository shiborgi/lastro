/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { InvalidRequestError, UnauthorizedError } from "@lastro/kernel";
import { SignedItemError } from "../domain/records";
import { financeTestHost } from "../testing";

type Row = { id: string } & Record<string, unknown>;

async function ledger() {
  const { host, as } = financeTestHost();
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(`finance.${id}`, as("editor"), input)) as T;
  const bank = await run("createAccount", {
    key: "bank",
    name: "Bank",
    type: "ACCOUNT",
  });
  const cash = await run("createAccount", {
    key: "till",
    name: "Caixa",
    type: "CASH",
  });
  const client = await run("createParty", {
    key: "client",
    name: "Client",
    type: "COMPANY",
  });
  const income = await run("createFinancialCategory", {
    name: "Serviços",
    kind: "REVENUE",
  });
  const fees = await run("createFinancialCategory", {
    name: "Taxas",
    kind: "REVENUE",
    role: "DEDUCTION",
  });
  const costs = await run("createFinancialCategory", {
    name: "Insumos",
    kind: "EXPENSE",
  });
  const base = {
    partyId: client.id,
    financialCategoryId: income.id,
    currency: "BRL",
    referenceMonth: "2026-11-01",
  };
  const revenue = (amount: string, key = `r-${amount}`) =>
    run("createRevenue", { ...base, key, amount });
  const receipt = (currency = "BRL") =>
    run("createReceipt", {
      accountId: bank.id,
      currency,
      referenceMonth: "2026-11-01",
      paidOn: "2026-11-12",
    });
  return { run, bank, cash, base, fees, costs, revenue, receipt };
}

describe("revenues entered on their own", () => {
  test("need a plain REVENUE category, keep their amount, and are settled in parts up to it", async () => {
    const { run, base, fees, costs, revenue, receipt } = await ledger();
    const service = await revenue("1000");
    expect(service).toMatchObject({ amount: "1000" });
    await expect(
      run("createRevenue", {
        ...base,
        key: "x",
        amount: "1",
        financialCategoryId: costs.id,
      }),
    ).rejects.toThrow(InvalidRequestError);
    await expect(
      run("createRevenue", {
        ...base,
        key: "y",
        amount: "1",
        financialCategoryId: fees.id,
      }),
    ).rejects.toThrow(SignedItemError);

    const into = await receipt();
    const settled = await run<{ receipt: Row; revenue: Row }>("settleRevenue", {
      revenueId: service.id,
      receiptId: into.id,
      amount: "800",
    });
    expect(settled.receipt.amount).toBe("800");
    expect(settled.revenue.amount).toBe("1000");
    expect(await run("getRevenue", { id: service.id })).toMatchObject({
      settled: "800",
      outstanding: "200",
      status: "PARTIALLY_SETTLED",
    });
    await expect(
      run("settleRevenue", {
        revenueId: service.id,
        receiptId: into.id,
        amount: "201",
      }),
    ).rejects.toThrow("exceeds the 200 still open");
  });

  test("refuse another currency, and void a settlement once", async () => {
    const { run, revenue, receipt } = await ledger();
    const service = await revenue("500");
    await expect(
      run("settleRevenue", {
        revenueId: service.id,
        receiptId: (await receipt("USD")).id,
        amount: "1",
      }),
    ).rejects.toThrow("the revenue is in BRL and the receipt in USD");
    const into = await receipt();
    const { settlement } = await run<{ settlement: Row }>("settleRevenue", {
      revenueId: service.id,
      receiptId: into.id,
      amount: "500",
    });
    expect(
      await run("voidRevenueSettlement", {
        id: settlement.id,
        voidReason: "duplicate",
      }),
    ).toMatchObject({
      voidReason: "duplicate",
    });
    expect(await run("getReceipt", { id: into.id })).toMatchObject({
      receipt: { amount: "0" },
    });
    await expect(
      run("voidRevenueSettlement", { id: settlement.id }),
    ).rejects.toThrow(UnauthorizedError);
  });

  test("a receipt needs a date and lists by account", async () => {
    const { run, bank, receipt } = await ledger();
    await expect(
      run("createReceipt", {
        accountId: bank.id,
        currency: "BRL",
        referenceMonth: "2026-11-01",
      }),
    ).rejects.toThrow("a receipt needs a due or paid date");
    await receipt();
    expect(
      (await run<{ items: Row[] }>("listReceipts", { accountId: bank.id }))
        .items,
    ).toHaveLength(1);
    expect(
      (await run<{ items: Row[] }>("listReceipts", { accountId: "99" })).items,
    ).toHaveLength(0);
  });
});

describe("transfers", () => {
  test("move between two accounts of the Book and list from either side", async () => {
    const { run, bank, cash } = await ledger();
    const move = {
      key: "t1",
      sourceAccountId: cash.id,
      destinationAccountId: bank.id,
      amount: "2000",
      currency: "BRL",
      referenceMonth: "2026-11-01",
      occurredOn: "2026-11-12",
    };
    const transfer = await run("createTransfer", move);
    expect(transfer).toMatchObject({
      amount: "2000",
      occurredOn: "2026-11-12",
      name: null,
    });
    for (const account of [bank.id, cash.id])
      expect(
        (await run<{ items: Row[] }>("listTransfers", { accountId: account }))
          .items,
      ).toEqual([transfer]);
    await expect(
      run("createTransfer", {
        ...move,
        key: "t2",
        destinationAccountId: cash.id,
      }),
    ).rejects.toThrow("two different accounts");
    await expect(
      run("createTransfer", { ...move, key: "t3", sourceAccountId: "99" }),
    ).rejects.toThrow("sourceAccountId names no account");
  });
});

describe("receiving a revenue now", () => {
  test("opens a received receipt and settles the share in one write", async () => {
    const { run, bank, revenue } = await ledger();
    const service = await revenue("1000");
    const received = await run<{ receipt: Row; revenue: Row }>(
      "receiveRevenue",
      {
        revenueId: service.id,
        accountId: bank.id,
        amount: "1000",
        paidOn: "2026-11-12",
        method: "PIX",
      },
    );
    expect(received.receipt).toMatchObject({
      amount: "1000",
      paidOn: "2026-11-12",
      method: "PIX",
    });
    expect(received.revenue.amount).toBe("1000");
    await expect(
      run("receiveRevenue", {
        revenueId: service.id,
        accountId: bank.id,
        amount: "1",
      }),
    ).rejects.toThrow("receiving needs paidOn or paidAt");
  });
});
