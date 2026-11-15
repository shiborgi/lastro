/// <reference types="bun-types" />
/* The revenue cycle and transfers through the composed host, on the real database. */
import { afterAll, describe, expect, test } from "bun:test";
import { revenues } from "@lastro/finance/db";
import { createHost } from "@lastro/host";
import { toFailure } from "@lastro/kernel";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

type Row = { id: string } & Record<string, unknown>;

async function ledger() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = async <T = Row>(id: string, input: unknown, key?: string) =>
    (await host.execute(
      `finance.${id}`,
      seeded.as("EDITOR", key ? { idempotencyKey: key } : {}),
      input,
    )) as T;
  const bank = await run("createAccount", {
    key: "bank",
    name: "Bank",
    type: "ACCOUNT",
  });
  const second = await run("createAccount", {
    key: "nu",
    name: "Second Bank",
    type: "ACCOUNT",
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
  return { ...seeded, run, bank, second, client, income, fees };
}

describe("the revenue cycle on PostgreSQL", () => {
  test("a revenue keeps its amount, is settled in parts up to it, and the receipt sums them", async () => {
    const { run, bank, client, income } = await ledger();
    const service = await run("createRevenue", {
      key: "nf-1",
      partyId: client.id,
      financialCategoryId: income.id,
      amount: "1000",
      currency: "BRL",
      referenceMonth: "2026-11-01",
    });
    const receipt = (paidOn: string) =>
      run("createReceipt", {
        accountId: bank.id,
        currency: "BRL",
        referenceMonth: "2026-11-01",
        paidOn,
      });
    const [first, second] = [
      await receipt("2026-11-10"),
      await receipt("2026-11-20"),
    ];
    await run("settleRevenue", {
      revenueId: service.id,
      receiptId: first.id,
      amount: "400",
    });
    const last = await run<{ settlement: Row; revenue: Row; receipt: Row }>(
      "settleRevenue",
      {
        revenueId: service.id,
        receiptId: second.id,
        amount: "600",
      },
    );
    expect(last.revenue.amount).toBe("1000");
    expect(last.receipt.amount).toBe("600");
    await expect(
      run("settleRevenue", {
        revenueId: service.id,
        receiptId: second.id,
        amount: "1",
      }),
    ).rejects.toThrow("exceeds the 0 still open");

    await run("voidRevenueSettlement", { id: last.settlement.id });
    expect(await run("getRevenue", { id: service.id })).toMatchObject({
      revenue: { amount: "1000" },
      settled: "400",
      outstanding: "600",
    });
  });

  test("a transfer replays by key and refuses a duplicate key", async () => {
    const { run, bank, second } = await ledger();
    const move = {
      key: "pix-1",
      sourceAccountId: bank.id,
      destinationAccountId: second.id,
      amount: "5000",
      currency: "BRL",
      referenceMonth: "2026-11-01",
      occurredAt: "2026-11-12T18:03:00.000Z",
    };
    const first = await run("createTransfer", move, "move-1");
    expect(await run<unknown>("createTransfer", move, "move-1")).toEqual(first);
    expect(
      toFailure(
        await run("createTransfer", move).catch((error: unknown) => error),
      ),
    ).toMatchObject({
      status: 409,
      message: "a record with the same identity already exists",
    });
    expect(
      await run<unknown>("listTransfers", { accountId: second.id }),
    ).toEqual({
      items: [first],
      nextCursor: null,
    });
  });
});
