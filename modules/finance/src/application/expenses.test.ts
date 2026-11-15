/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { InvalidRequestError, UnauthorizedError } from "@lastro/kernel";
import { SignedItemError } from "../domain/records";
import { financeTestHost } from "../testing";

type Row = { id: string } & Record<string, unknown>;
type Settled = {
  settlement: Row;
  discount: { expense: Row; settlement: Row } | null;
  payment: Row;
};

async function ledger() {
  const { host, memory, as } = financeTestHost();
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(`finance.${id}`, as("editor"), input)) as T;
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
  const income = await run("createFinancialCategory", {
    name: "Vendas",
    kind: "REVENUE",
  });
  const expense = (amount: string, key = `e-${amount}`) =>
    run("createExpense", {
      key,
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      amount,
      currency: "BRL",
      referenceMonth: "2026-11-01",
    });
  const payment = (currency = "BRL") =>
    run("createPayment", {
      accountId: bank.id,
      currency,
      referenceMonth: "2026-11-01",
      dueOn: "2026-11-10",
    });
  return {
    run,
    memory,
    bank,
    supplier,
    supplies,
    discounts,
    income,
    expense,
    payment,
  };
}

describe("expenses", () => {
  test("an expense needs a plain EXPENSE category and a party of the Book", async () => {
    const { run, supplier, supplies, discounts, income } = await ledger();
    const base = {
      key: "k",
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      amount: "100",
      currency: "BRL",
      referenceMonth: "2026-11-15",
    };
    expect(await run("createExpense", base)).toMatchObject({
      amount: "100",
      referenceMonth: "2026-11-15",
      name: null,
      occurredOn: null,
    });
    await expect(
      run("createExpense", {
        ...base,
        key: "r",
        financialCategoryId: income.id,
      }),
    ).rejects.toThrow(InvalidRequestError);
    await expect(
      run("createExpense", {
        ...base,
        key: "d",
        financialCategoryId: discounts.id,
      }),
    ).rejects.toThrow(SignedItemError);
    await expect(
      run("createExpense", { ...base, key: "p", partyId: "99" }),
    ).rejects.toThrow("partyId names no party");
    await expect(
      run("createExpense", { ...base, key: "n", amount: "-5" }),
    ).rejects.toThrow();
  });

  test("a payment needs a due date", async () => {
    const { run, bank } = await ledger();
    await expect(
      run("createPayment", {
        accountId: bank.id,
        currency: "BRL",
        referenceMonth: "2026-11-01",
      }),
    ).rejects.toThrow("a payment needs dueOn or dueAt");
  });
});

describe("settling", () => {
  test("shares accumulate on the payment and the expense position follows", async () => {
    const { run, expense, payment } = await ledger();
    const bill = await expense("1000");
    const invoice = await payment();
    await run("settleExpense", {
      expenseId: bill.id,
      paymentId: invoice.id,
      amount: "400",
    });
    const second = await run<Settled>("settleExpense", {
      expenseId: bill.id,
      paymentId: invoice.id,
      amount: "600",
      installmentNumber: 2,
      installmentCount: 2,
    });
    expect(second.payment.amount).toBe("1000");
    expect(second.settlement).toMatchObject({
      installmentNumber: 2,
      installmentCount: 2,
    });
    expect(await run("getExpense", { id: bill.id })).toMatchObject({
      settled: "1000",
      outstanding: "0",
      status: "SETTLED",
    });
    await expect(
      run("settleExpense", {
        expenseId: bill.id,
        paymentId: invoice.id,
        amount: "1",
      }),
    ).rejects.toThrow("exceeds the 0 still open");
  });

  test("refuses another currency and a share of an unknown record", async () => {
    const { run, expense, payment } = await ledger();
    const bill = await expense("1000");
    const dollars = await payment("USD");
    await expect(
      run("settleExpense", {
        expenseId: bill.id,
        paymentId: dollars.id,
        amount: "10",
      }),
    ).rejects.toThrow("the expense is in BRL and the payment in USD");
    await expect(
      run("settleExpense", {
        expenseId: "99",
        paymentId: dollars.id,
        amount: "10",
      }),
    ).rejects.toThrow(UnauthorizedError);
    await expect(
      run("settleExpense", {
        expenseId: bill.id,
        paymentId: (await payment()).id,
        amount: "10",
        installmentNumber: 3,
        installmentCount: 2,
      }),
    ).rejects.toThrow(SignedItemError);
  });

  test("a discount is a negative expense in the same payment, and is voided first", async () => {
    const { run, memory, expense, discounts, supplies, bank } = await ledger();
    const bill = await expense("1000");
    const paid = await run<Settled>("payExpense", {
      expenseId: bill.id,
      accountId: bank.id,
      amount: "1000",
      paidOn: "2026-11-12",
      method: "PIX",
      discount: { amount: "50", financialCategoryId: discounts.id },
    });
    expect(paid.payment).toMatchObject({
      amount: "950",
      paidOn: "2026-11-12",
      dueOn: "2026-11-12",
      method: "PIX",
      referenceMonth: "2026-11-01",
    });
    expect(paid.discount?.expense).toMatchObject({
      key: `discount-${paid.settlement.id}`,
      amount: "-50",
      financialCategoryId: discounts.id,
      occurredOn: "2026-11-12",
    });
    expect(paid.discount?.settlement.amount).toBe("-50");

    await expect(
      run("settleExpense", {
        expenseId: (await expense("10", "small")).id,
        paymentId: paid.payment.id,
        amount: "10",
        discount: { amount: "50", financialCategoryId: discounts.id },
      }),
    ).rejects.toThrow("cannot exceed");
    await expect(
      run("settleExpense", {
        expenseId: bill.id,
        paymentId: paid.payment.id,
        amount: "1",
        discount: { amount: "1", financialCategoryId: supplies.id },
      }),
    ).rejects.toThrow("DEDUCTION role");

    const voided = await run<{ settlement: Row; voidedDiscount: Row | null }>(
      "voidExpenseSettlement",
      { id: paid.settlement.id, voidReason: "wrong account" },
    );
    expect(voided.voidedDiscount?.id).toBe(paid.discount?.settlement.id);
    expect(voided.settlement).toMatchObject({
      voidReason: "wrong account",
      voidedBy: "editor",
    });
    expect(await run("getPayment", { id: paid.payment.id })).toMatchObject({
      payment: { amount: "0" },
    });
    expect(await run("getExpense", { id: bill.id })).toMatchObject({
      status: "OPEN",
    });
    await expect(
      run("voidExpenseSettlement", { id: paid.settlement.id }),
    ).rejects.toThrow(UnauthorizedError);
    expect(memory.audits.map((event) => event.action).slice(-2)).toEqual([
      "expense_settlement.voided",
      "expense_settlement.voided",
    ]);
  });

  test("a deduction is never settled on its own", async () => {
    const { run, expense, payment, discounts, bank } = await ledger();
    const paid = await run<Settled>("payExpense", {
      expenseId: (await expense("100")).id,
      accountId: bank.id,
      amount: "100",
      paidAt: "2026-11-12T15:00:00.000Z",
      discount: { amount: "10", financialCategoryId: discounts.id },
    });
    await expect(
      run("settleExpense", {
        expenseId: paid.discount?.expense.id,
        paymentId: (await payment()).id,
        amount: "5",
      }),
    ).rejects.toThrow(SignedItemError);
  });
});

describe("reading the cycle", () => {
  test("open expenses list what remains, with totals per currency", async () => {
    const { run, expense, payment } = await ledger();
    const a = await expense("1000");
    const b = await expense("300");
    await run("settleExpense", {
      expenseId: a.id,
      paymentId: (await payment()).id,
      amount: "1000",
    });
    await run("settleExpense", {
      expenseId: b.id,
      paymentId: (await payment()).id,
      amount: "100",
    });
    expect(await run("listOpenExpenses", {})).toMatchObject({
      items: [
        {
          expense: { id: b.id },
          outstanding: "200",
          status: "PARTIALLY_SETTLED",
        },
      ],
      totals: [{ currency: "BRL", outstanding: "200", count: 1 }],
    });
  });

  test("lists page in id order and filter", async () => {
    const { run, expense, payment, bank } = await ledger();
    const ids = [
      (await expense("1")).id,
      (await expense("2")).id,
      (await expense("3")).id,
    ];
    const first = await run<{ items: Row[]; nextCursor: string | null }>(
      "listExpenses",
      { limit: 2 },
    );
    expect(first.items.map((each) => each.id)).toEqual(ids.slice(0, 2));
    const rest = await run<{ items: Row[]; nextCursor: string | null }>(
      "listExpenses",
      {
        limit: 2,
        cursor: first.nextCursor,
      },
    );
    expect(rest).toMatchObject({ items: [{ id: ids[2] }], nextCursor: null });
    expect(
      await run<unknown>("listExpenses", { referenceMonth: "2026-12-01" }),
    ).toEqual({
      items: [],
      nextCursor: null,
    });
    await payment();
    expect(
      (await run<{ items: Row[] }>("listPayments", { accountId: bank.id }))
        .items,
    ).toHaveLength(1);
  });
});

describe("totals for dependent modules", () => {
  test("sum by the financial category's role, own or inherited, within the months", async () => {
    const { host, as } = financeTestHost();
    const run = async (id: string, input: unknown) =>
      (await host.execute(`finance.${id}`, as("editor"), input)) as {
        id: string;
      };
    const party = await run("createParty", {
      key: "landlord",
      name: "Landlord",
      type: "PERSON",
    });
    const fixed = await run("createFinancialCategory", {
      name: "Fixas",
      kind: "EXPENSE",
      role: "FIXED",
    });
    const rent = await run("createFinancialCategory", {
      name: "Aluguel",
      kind: "EXPENSE",
      parentId: fixed.id,
    });
    const energy = await run("createFinancialCategory", {
      name: "Energia",
      kind: "EXPENSE",
      role: "FIXED",
    });
    const goods = await run("createFinancialCategory", {
      name: "Insumos",
      kind: "EXPENSE",
      role: "MERCHANDISE",
    });
    const record = (
      key: string,
      financialCategoryId: string,
      amount: string,
      referenceMonth: string,
    ) =>
      run("createExpense", {
        key,
        partyId: party.id,
        financialCategoryId,
        amount,
        currency: "BRL",
        referenceMonth,
      });
    await record("rent-nov", rent.id, "300000", "2026-11-01");
    await record("energy-nov", energy.id, "45000", "2026-11-01");
    await record("goods-nov", goods.id, "90000", "2026-11-01");
    await record("rent-dec", rent.id, "300000", "2026-12-01");

    const finance = host.modules.finance as import("./module").FinanceApi;
    const scope = { context: as("editor"), handle: null, audit: () => {} };
    const november = {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    };
    expect(
      await finance.expenses.totalByRole(scope, { ...november, role: "FIXED" }),
    ).toEqual(new Map([["BRL", 345000n]]));
    expect(
      await finance.expenses.totalByRole(scope, {
        ...november,
        role: "MERCHANDISE",
      }),
    ).toEqual(new Map([["BRL", 90000n]]));
  });
});
