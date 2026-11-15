/// <reference types="bun-types" />
/*
 * Finance's database rules, exercised with plain inserts: these hold for any
 * caller, whatever the application above them does. One test per trigger or
 * group of checks in `modules/finance/src/db/triggers.sql`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  accountCycles,
  accounts,
  expenseSettlements,
  expenses,
  financialCategories,
  parties,
  payments,
  receipts,
  revenueSettlements,
  revenues,
} from "@lastro/finance/db";
import { and, eq } from "drizzle-orm";
import { expectPgError } from "../compose";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
afterAll(() => closeDb(db));

const REFUSED = "23514";
const month = new Date("2026-11-01T00:00:00Z");
const day = (text: string) => new Date(`${text}T00:00:00Z`);

async function ledger() {
  const { book } = await seedBook(db, ["OWNER"]);
  const bookId = Number(book.id);
  let sequence = 0;
  const key = (prefix: string) => `${prefix}-${++sequence}`;

  const account = async (type = "ACCOUNT") => {
    const [row] = await db
      .insert(accounts)
      .values({ bookId, key: key("acc"), name: type, type })
      .returning();
    return row?.id as number;
  };
  const party = async (extra: Partial<typeof parties.$inferInsert> = {}) => {
    const [row] = await db
      .insert(parties)
      .values({
        bookId,
        key: key("party"),
        name: "Party",
        type: "COMPANY",
        ...extra,
      })
      .returning();
    return row?.id as number;
  };
  const category = async (
    kind: "EXPENSE" | "REVENUE",
    extra: Partial<typeof financialCategories.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(financialCategories)
      .values({ bookId, kind, name: key(kind), ...extra })
      .returning();
    return row?.id as number;
  };
  const expense = async (
    amount: bigint,
    financialCategoryId: number,
    partyId: number,
  ) => {
    const [row] = await db
      .insert(expenses)
      .values({
        bookId,
        key: key("exp"),
        partyId,
        financialCategoryId,
        amount,
        currency: "BRL",
        referenceMonth: month,
      })
      .returning();
    return row?.id as number;
  };
  const payment = async (accountId: number) => {
    const [row] = await db
      .insert(payments)
      .values({ bookId, accountId, currency: "BRL", referenceMonth: month })
      .returning();
    return row?.id as number;
  };
  const settleExpense = async (
    expenseId: number,
    paymentId: number,
    amount: bigint,
  ) => {
    const [row] = await db
      .insert(expenseSettlements)
      .values({
        bookId,
        expenseId,
        paymentId,
        amount,
        currency: "BRL",
        installmentNumber: 1,
        installmentCount: 1,
      })
      .returning();
    return row?.id as number;
  };
  const revenue = async (
    amount: bigint,
    financialCategoryId: number,
    partyId: number,
    extra: Partial<typeof revenues.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(revenues)
      .values({
        bookId,
        key: key("rev"),
        partyId,
        financialCategoryId,
        amount,
        currency: "BRL",
        referenceMonth: month,
        ...extra,
      })
      .returning();
    return row?.id as number;
  };
  const receipt = async (
    accountId: number,
    extra: Partial<typeof receipts.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(receipts)
      .values({
        bookId,
        accountId,
        currency: "BRL",
        referenceMonth: month,
        ...extra,
      })
      .returning();
    return row?.id as number;
  };
  const settleRevenue = async (
    revenueId: number,
    receiptId: number,
    amount: bigint,
  ) => {
    const [row] = await db
      .insert(revenueSettlements)
      .values({ bookId, revenueId, receiptId, amount, currency: "BRL" })
      .returning();
    return row?.id as number;
  };
  const amountOf = async (
    table: typeof payments | typeof receipts | typeof revenues,
    id: number,
  ) => {
    const [row] = await db
      .select({ amount: table.amount })
      .from(table)
      .where(and(eq(table.bookId, bookId), eq(table.id, id)));
    return row?.amount;
  };
  const voidSettlement = (
    table: typeof expenseSettlements | typeof revenueSettlements,
    id: number,
  ) =>
    db
      .update(table)
      .set({ voidedAt: new Date(), voidedBy: "test", voidReason: "test" })
      .where(and(eq(table.bookId, bookId), eq(table.id, id)));

  return {
    bookId,
    account,
    party,
    category,
    expense,
    payment,
    settleExpense,
    revenue,
    receipt,
    settleRevenue,
    amountOf,
    voidSettlement,
  };
}

describe("expense settlements", () => {
  test("cannot exceed the expense, and the payment is their signed sum", async () => {
    const l = await ledger();
    const bank = await l.account();
    const expenseId = await l.expense(
      1000n,
      await l.category("EXPENSE"),
      await l.party(),
    );
    const paymentId = await l.payment(bank);

    const first = await l.settleExpense(expenseId, paymentId, 600n);
    expect(await l.amountOf(payments, paymentId)).toBe(600n);
    await expectPgError(l.settleExpense(expenseId, paymentId, 500n), REFUSED);
    await expectPgError(l.settleExpense(expenseId, paymentId, -100n), REFUSED);

    await l.voidSettlement(expenseSettlements, first);
    expect(await l.amountOf(payments, paymentId)).toBe(0n);
    // The voided share is free again.
    await l.settleExpense(expenseId, paymentId, 1000n);
    expect(await l.amountOf(payments, paymentId)).toBe(1000n);
  });

  test("a discount is a negative expense beside a positive one, never alone", async () => {
    const l = await ledger();
    const bank = await l.account();
    const supplier = await l.party();
    const bill = await l.expense(1000n, await l.category("EXPENSE"), supplier);
    const discount = await l.expense(
      -50n,
      await l.category("EXPENSE", { role: "DEDUCTION" }),
      supplier,
    );
    const paymentId = await l.payment(bank);

    // A payment cannot go below zero, so the positive item settles first.
    await expectPgError(l.settleExpense(discount, paymentId, -50n), REFUSED);
    await l.settleExpense(bill, paymentId, 1000n);
    await l.settleExpense(discount, paymentId, -50n);
    expect(await l.amountOf(payments, paymentId)).toBe(950n);
    await expectPgError(l.settleExpense(discount, paymentId, -1n), REFUSED);
  });
});

describe("financial categories", () => {
  test("nest one level, within one kind, and a group holds no records", async () => {
    const l = await ledger();
    const group = await l.category("EXPENSE");
    const child = await l.category("EXPENSE", { parentId: group });

    await expectPgError(l.category("EXPENSE", { parentId: child }), REFUSED);
    await expectPgError(l.category("REVENUE", { parentId: group }), REFUSED);
    // A group cannot itself be moved under another group.
    const other = await l.category("EXPENSE");
    await expectPgError(
      db
        .update(financialCategories)
        .set({ parentId: other })
        .where(
          and(
            eq(financialCategories.bookId, l.bookId),
            eq(financialCategories.id, group),
          ),
        ),
      REFUSED,
    );
    // Posting to a group is refused; posting to its leaf is not.
    const supplier = await l.party();
    await expectPgError(l.expense(100n, group, supplier), REFUSED);
    await l.expense(100n, child, supplier);
    // A category with records cannot become a group.
    const used = await l.category("EXPENSE");
    await l.expense(100n, used, supplier);
    await expectPgError(l.category("EXPENSE", { parentId: used }), REFUSED);
  });

  test("an item is negative exactly in a DEDUCTION category, own or inherited", async () => {
    const l = await ledger();
    const who = await l.party();
    const plain = await l.category("REVENUE");
    const deductions = await l.category("REVENUE", { role: "DEDUCTION" });
    const fee = await l.category("REVENUE", { parentId: deductions });

    await expectPgError(l.revenue(-10n, plain, who), REFUSED);
    await expectPgError(l.revenue(10n, fee, who), REFUSED);
    await l.revenue(-10n, fee, who);
    await l.revenue(10n, plain, who);
    await expectPgError(
      l.expense(-10n, await l.category("EXPENSE"), who),
      REFUSED,
    );

    // A role change that would leave existing items with the wrong sign.
    for (const [id, role] of [
      [plain, "DEDUCTION"],
      [deductions, null],
    ] as const) {
      await expectPgError(
        db
          .update(financialCategories)
          .set({ role })
          .where(
            and(
              eq(financialCategories.bookId, l.bookId),
              eq(financialCategories.id, id),
            ),
          ),
        REFUSED,
      );
    }
  });
});

describe("billing windows", () => {
  test("two windows of one card cannot overlap", async () => {
    const l = await ledger();
    const card = await l.account("CARD");
    const window = (referenceMonth: string, startsOn: string, endsOn: string) =>
      db.insert(accountCycles).values({
        bookId: l.bookId,
        accountId: card,
        referenceMonth: day(referenceMonth),
        startsOn: day(startsOn),
        endsOn: day(endsOn),
        dueOn: day(endsOn),
      });
    await window("2026-10-01", "2026-09-05", "2026-10-04");
    await expectPgError(
      window("2026-11-01", "2026-10-04", "2026-11-03"),
      REFUSED,
    );
    await window("2026-11-01", "2026-10-05", "2026-11-03");
    await expectPgError(
      window("2026-12-01", "2026-12-10", "2026-12-01"),
      REFUSED,
    );
  });
});

describe("stated revenues (ADR 7)", () => {
  test("a revenue keeps its amount; its active settlements carry its sign and never exceed it", async () => {
    const l = await ledger();
    const bank = await l.account();
    const revenueId = await l.revenue(
      500n,
      await l.category("REVENUE"),
      await l.party(),
    );
    const first = await l.settleRevenue(revenueId, await l.receipt(bank), 300n);
    const receiptId = await l.receipt(bank);
    await l.settleRevenue(revenueId, receiptId, 200n);
    expect(await l.amountOf(revenues, revenueId)).toBe(500n);
    expect(await l.amountOf(receipts, receiptId)).toBe(200n);

    await expectPgError(l.settleRevenue(revenueId, receiptId, -1n), REFUSED);
    await expectPgError(l.settleRevenue(revenueId, receiptId, 1n), REFUSED);

    await l.voidSettlement(revenueSettlements, first);
    expect(await l.amountOf(revenues, revenueId)).toBe(500n);
    await l.settleRevenue(revenueId, receiptId, 300n);
    expect(await l.amountOf(receipts, receiptId)).toBe(500n);
  });
});

describe("tenancy and value checks", () => {
  test("a record cannot reference another Book's catalog", async () => {
    const mine = await ledger();
    const theirs = await ledger();
    await expectPgError(
      mine.expense(100n, await mine.category("EXPENSE"), await theirs.party()),
      "23503",
    );
  });

  test("zero items, unknown account types and malformed currencies are refused", async () => {
    const l = await ledger();
    const who = await l.party();
    const cost = await l.category("EXPENSE");
    await expectPgError(l.expense(0n, cost, who), REFUSED);
    await expectPgError(l.account("WALLET"), REFUSED);
    await expectPgError(
      db.insert(payments).values({
        bookId: l.bookId,
        accountId: await l.account(),
        currency: "brl",
        referenceMonth: month,
      }),
      REFUSED,
    );
  });
});
