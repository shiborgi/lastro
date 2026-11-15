import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cardMovementPayments, cardMovements } from "@lastro/finance/db";
/// <reference types="bun-types" />
/*
 * The c6-card flow on the real database (docs/flows/c6-card.md, ADR 18): an
 * invoice taken into a card, purchases posted as one expense and one invoice
 * payment per instalment, the next invoice attaching to its instalment, and
 * the rules the card tables hold for any caller.
 */
import { accountMovementSides } from "@lastro/finance/testing";
import { createHost } from "@lastro/host";
import { and, eq } from "drizzle-orm";
import { expectPgError } from "../compose";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

const FIXTURES = resolve(
  import.meta.dir,
  "../../../../modules/finance-imports/src/parsers/c6-card/fixtures",
);
const fixture = (name: string) => readFileSync(resolve(FIXTURES, name), "utf8");

type Row = { id: string } & Record<string, unknown>;
type Links = {
  expenses: { expenseKey: string; expenseId: string }[];
  payments: {
    paymentKey: string;
    installmentNumber: number;
    paymentId: string;
    settlementId: string;
    movementId: string | null;
  }[];
};

async function card() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(id, seeded.as("EDITOR"), input)) as T;
  const sides = accountMovementSides(run);
  const account = await run("finance.createAccount", {
    key: "c6-card",
    name: "Cartão C6",
    type: "CARD",
  });
  const party = await run("finance.createParty", {
    key: "fornecedor",
    name: "Fornecedor",
    type: "COMPANY",
  });
  const supplies = await run("finance.createFinancialCategory", {
    name: "Insumos",
    kind: "EXPENSE",
  });
  for (const [month, last] of [
    ["04", "30"],
    ["06", "30"],
    ["08", "31"],
    ["09", "30"],
  ])
    await run("finance.createAccountCycle", {
      accountId: account.id,
      referenceMonth: `2026-${month}-01`,
      startsOn: `2026-${month}-01`,
      endsOn: `2026-${month}-${last}`,
      dueOn: `2026-${String(Number(month) + 1).padStart(2, "0")}-10`,
    });
  await run("finance-imports.setMovementConsumer", {
    accountId: account.id,
    type: "card-movements",
    importerId: "c6/card",
  });
  const take = (name: string) =>
    run<Row & { posted: number; new: number }>(
      "finance-imports.importMovements",
      {
        accountId: account.id,
        type: "card-movements",
        key: `drive/faturas/c6/${name}`,
        content: fixture(name),
      },
    );
  const classify = (descriptorKey: string) =>
    run<{ posted: number }>("finance.classifyCardMovementDescriptor", {
      accountId: account.id,
      descriptorKey,
      partyId: party.id,
      financialCategoryId: supplies.id,
      paymentMethod: "CREDIT_CARD",
    });
  const links = () =>
    run<Links>("finance.listCardMovementLinks", { accountId: account.id });
  const lines = async (query: Record<string, unknown> = {}) =>
    (await run<{ items: Row[] }>("finance.listCardMovements", query)).items;
  return {
    bookId: Number(seeded.book.id),
    run,
    sides,
    take,
    classify,
    links,
    lines,
    account,
  };
}

describe("a C6 card invoice on PostgreSQL", () => {
  test("a purchase is one expense and one invoice payment per instalment; the next invoice attaches", async () => {
    const { take, classify, links, lines, run, account } = await card();
    expect(await take("august.csv")).toMatchObject({ new: 5, posted: 0 });
    expect((await classify("escola_exemplo")).posted).toBe(1);
    expect((await take("september.csv")).posted).toBe(1);

    const { expenses, payments } = await links();
    expect(expenses).toHaveLength(1);
    expect(payments).toHaveLength(12);
    expect(
      payments
        .filter((each) => each.movementId)
        .map((each) => each.installmentNumber),
    ).toEqual([5, 6]);
    const { payment } = await run<{ payment: Row }>("finance.getPayment", {
      id: payments[4]?.paymentId,
    });
    expect(payment).toMatchObject({
      key: `card-${account.id}-2026-08`,
      amount: "36208",
      method: "CREDIT_CARD",
      dueOn: "2026-09-10",
    });
    const school = await lines({ descriptorKey: "escola_exemplo" });
    expect(school.map((each) => each.status)).toEqual(["POSTED", "POSTED"]);
  });
});

describe("the invoice paid on PostgreSQL", () => {
  test("the card's credit and the C6 outflow are one transfer, joined by statement key", async () => {
    const { run, take, lines, account, sides } = await card();
    const c6 = await run("finance.createAccount", {
      key: "c6",
      name: "C6",
      type: "ACCOUNT",
    });
    await run("finance-imports.setMovementConsumer", {
      accountId: c6.id,
      type: "account-movements",
      importerId: "c6/account",
    });
    await run("finance-imports.importMovements", {
      accountId: c6.id,
      type: "account-movements",
      key: "drive/extratos/c6/agosto.csv",
      content:
        "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)\n10/08/2026,10/08/2026,BANCO C6 S.A.,BANCO C6 S.A.,0.00,9827.29,59.42\n",
    });
    const [left] = (await sides.list<{ items: Row[] }>({ accountId: c6.id }))
      .items;
    expect(
      (
        await sides.classify<{ posted: number }>({
          accountId: c6.id,
          direction: "PAYMENT",
          descriptorKey: left?.descriptorKey,
          counterAccountId: account.id,
          paymentMethod: "BOLETO",
        })
      ).posted,
    ).toBe(1);
    await take("august.csv");
    expect(
      (
        await run<{ posted: number }>(
          "finance.classifyCardMovementDescriptor",
          {
            accountId: account.id,
            descriptorKey: "pag_fatura_boleto",
            counterAccountId: c6.id,
            paymentMethod: "BOLETO",
          },
        )
      ).posted,
    ).toBe(1);
    const [paid] = await lines({ descriptorKey: "pag_fatura_boleto" });
    expect(paid).toMatchObject({ status: "POSTED" });
    expect(
      (await run<{ items: Row[] }>("finance.listTransfers", {})).items,
    ).toEqual([
      expect.objectContaining({
        sourceAccountId: c6.id,
        destinationAccountId: account.id,
        amount: "982729",
      }),
    ]);
  });
});

describe("the card tables hold their rules for any caller", () => {
  test("a card line is POSTED only when an instalment names it", async () => {
    const { take, lines, bookId } = await card();
    await take("august.csv");
    const [line] = await lines();
    await expectPgError(
      db
        .update(cardMovements)
        .set({ status: "POSTED" })
        .where(
          and(
            eq(cardMovements.bookId, bookId),
            eq(cardMovements.id, Number(line?.id)),
          ),
        ),
      "23514",
    );
  });

  test("a line shows only its own instalment", async () => {
    const { take, classify, links, lines, bookId, account } = await card();
    await take("august.csv");
    await classify("escola_exemplo");
    const { payments } = await links();
    const [coffee] = await lines({ descriptorKey: "mercado_exemplo" });
    await expectPgError(
      db
        .update(cardMovementPayments)
        .set({ movementId: Number(coffee?.id) })
        .where(
          and(
            eq(cardMovementPayments.bookId, bookId),
            eq(cardMovementPayments.accountId, Number(account.id)),
            eq(
              cardMovementPayments.paymentKey,
              String(payments[0]?.paymentKey),
            ),
          ),
        ),
      "23514",
    );
  });
});
