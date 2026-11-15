/// <reference types="bun-types" />
/*
 * The expense cycle through the composed host, on the real database: the
 * payment's amount comes from the trigger, not from the application.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createHost } from "@lastro/host";
import { toFailure } from "@lastro/kernel";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

type Row = { id: string } & Record<string, unknown>;
type Settled = {
  settlement: Row;
  discount: { expense: Row; settlement: Row } | null;
  payment: Row;
};

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
  const supplier = await run("createParty", {
    key: "assai",
    name: "Assaí",
    type: "COMPANY",
  });
  const supplies = await run("createFinancialCategory", {
    name: "Insumos",
    kind: "EXPENSE",
  });
  const discounts = await run("createFinancialCategory", {
    name: "Descontos obtidos",
    kind: "EXPENSE",
    role: "DEDUCTION",
  });
  let sequence = 0;
  const expense = (amount: string) =>
    run("createExpense", {
      key: `e-${++sequence}`,
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      amount,
      currency: "BRL",
      referenceMonth: "2026-11-01",
    });
  const payment = () =>
    run("createPayment", {
      accountId: bank.id,
      currency: "BRL",
      referenceMonth: "2026-11-01",
      dueOn: "2026-11-10",
    });
  return { ...seeded, run, bank, discounts, expense, payment };
}

describe("the expense cycle on PostgreSQL", () => {
  test("pay with a discount, read it back, void it in the right order", async () => {
    const { run, bank, discounts, expense } = await ledger();
    const bill = await expense("1000");
    const paid = await run<Settled>("payExpense", {
      expenseId: bill.id,
      accountId: bank.id,
      amount: "1000",
      paidAt: "2026-11-12T13:45:00.000Z",
      discount: { amount: "50", financialCategoryId: discounts.id },
    });
    // The trigger summed the share and the negative discount.
    expect(paid.payment).toMatchObject({
      amount: "950",
      paidAt: "2026-11-12T13:45:00.000Z",
    });
    expect(await run("getPayment", { id: paid.payment.id })).toMatchObject({
      payment: { amount: "950" },
      settlements: [{ amount: "1000" }, { amount: "-50" }],
    });

    const voided = await run<{ voidedDiscount: Row | null }>(
      "voidExpenseSettlement",
      {
        id: paid.settlement.id,
      },
    );
    expect(voided.voidedDiscount?.id).toBe(paid.discount?.settlement.id);
    expect(await run("getPayment", { id: paid.payment.id })).toMatchObject({
      payment: { amount: "0" },
    });
    expect(await run("getExpense", { id: bill.id })).toMatchObject({
      status: "OPEN",
    });
  });

  test("a replayed payExpense answers the first payment and pays nothing twice", async () => {
    const { run, bank, expense } = await ledger();
    const bill = await expense("300");
    const input = {
      expenseId: bill.id,
      accountId: bank.id,
      amount: "300",
      paidOn: "2026-11-12",
    };
    const first = await run<Settled>("payExpense", input, "pay-1");
    const again = await run<Settled>("payExpense", input, "pay-1");
    expect(again).toEqual(first);
    expect(
      (await run<{ items: Row[] }>("listPayments", {})).items,
    ).toHaveLength(1);
    expect(await run("getExpense", { id: bill.id })).toMatchObject({
      settled: "300",
    });
  });

  test("two concurrent shares that together exceed the expense: one lands", async () => {
    const { run, expense, payment } = await ledger();
    const bill = await expense("1000");
    const [a, b] = [await payment(), await payment()];
    const results = await Promise.allSettled([
      run("settleExpense", {
        expenseId: bill.id,
        paymentId: a.id,
        amount: "600",
      }),
      run("settleExpense", {
        expenseId: bill.id,
        paymentId: b.id,
        amount: "600",
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const refused = results.find((result) => result.status === "rejected");
    expect(toFailure((refused as PromiseRejectedResult).reason)).toMatchObject({
      status: 422,
      code: "SIGNED_ITEM",
    });
    expect(await run("getExpense", { id: bill.id })).toMatchObject({
      settled: "600",
    });
  });

  test("a payment from an account of another Book is a missing reference", async () => {
    const mine = await ledger();
    const theirs = await ledger();
    const failure = toFailure(
      await mine
        .run("createPayment", {
          accountId: theirs.bank.id,
          currency: "BRL",
          referenceMonth: "2026-11-01",
          dueOn: "2026-11-10",
        })
        .catch((error: unknown) => error),
    );
    expect(failure).toEqual({
      status: 409,
      code: "CONFLICT",
      message: "a record it references does not exist in this Book",
    });
  });

  test("open expenses and their totals come from active settlements", async () => {
    const { run, expense, payment } = await ledger();
    const a = await expense("1000");
    await expense("250");
    const share = await run<Settled>("settleExpense", {
      expenseId: a.id,
      paymentId: (await payment()).id,
      amount: "1000",
    });
    expect(await run("listOpenExpenses", {})).toMatchObject({
      items: [{ outstanding: "250" }],
      totals: [{ currency: "BRL", outstanding: "250", count: 1 }],
    });
    await run("voidExpenseSettlement", {
      id: share.settlement.id,
      voidReason: "duplicate",
    });
    expect(await run("listOpenExpenses", {})).toMatchObject({
      totals: [{ currency: "BRL", outstanding: "1250", count: 2 }],
    });
  });
});
