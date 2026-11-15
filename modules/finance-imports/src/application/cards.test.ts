/// <reference types="bun-types" />
/**
 * The c6-card flow through the real envelope over memory: an invoice taken
 * into a card, merchant names classified, one expense per purchase settled
 * into one invoice payment per instalment on the months the billing windows
 * say, later invoices attaching to the instalments already scheduled, and
 * undo (docs/flows/c6-card.md, ADR 18).
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

const fixture = (name: string) =>
  readFileSync(
    resolve(import.meta.dir, "../parsers/c6-card/fixtures", name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;
type Card = Row & {
  accountId: string;
  paymentMethod: string | null;
  descriptorKey: string;
  expenseKey: string;
  statementId: string;
  externalId: string;
  paymentKey: string;
  status: string;
  amount: string;
};
type Links = {
  expenses: { expenseKey: string; expenseId: string }[];
  payments: {
    paymentKey: string;
    installmentNumber: number;
    paymentId: string;
    movementId: string | null;
  }[];
  transfers: { statementKey: string; transferId: string }[];
};

const TYPE = "card-movements";

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
  const card = await finance("createAccount", {
    key: "c6-card",
    name: "Cartão C6",
    type: "CARD",
  });
  const party = await finance("createParty", {
    key: "fornecedor",
    name: "Fornecedor",
    type: "COMPANY",
  });
  const supplies = await finance("createFinancialCategory", {
    name: "Insumos",
    kind: "EXPENSE",
  });
  // Calendar-month windows from April to September 2026.
  const window = (month: string, last: string) =>
    finance("createAccountCycle", {
      accountId: card.id,
      referenceMonth: `2026-${month}-01`,
      startsOn: `2026-${month}-01`,
      endsOn: `2026-${month}-${last}`,
      // Due on the 10th of the next month.
      dueOn: `2026-${String(Number(month) + 1).padStart(2, "0")}-10`,
    });
  for (const [month, last] of [
    ["04", "30"],
    ["06", "30"],
    ["08", "31"],
  ] as const)
    await window(month, last);
  await run("finance-imports.setMovementConsumer", {
    accountId: card.id,
    type: TYPE,
    importerId: "c6/card",
  });
  const take = (name: string) =>
    run<Row & { posted: number; pending: number; new: number }>(
      "finance-imports.importMovements",
      {
        accountId: card.id,
        type: TYPE,
        key: `drive/faturas/c6/${name}`,
        content: fixture(name),
      },
    );
  const lines = async (query: Record<string, unknown> = {}) =>
    (await finance<{ items: Card[] }>("listCardMovements", query)).items;
  const classify = (descriptorKey: string) =>
    finance<{ posted: number }>("classifyCardMovementDescriptor", {
      accountId: card.id,
      descriptorKey,
      partyId: party.id,
      financialCategoryId: supplies.id,
      paymentMethod: "CREDIT_CARD",
    });
  const links = (query: Record<string, unknown> = {}) =>
    finance<Links>("listCardMovementLinks", query);
  return {
    run,
    finance,
    sides,
    take,
    lines,
    classify,
    links,
    window,
    card,
    party,
    supplies,
  };
}

describe("taking a C6 card invoice in", () => {
  test("stages each line once, new names wait, and the same content writes nothing", async () => {
    const { take, lines } = await book();
    expect(await take("august.csv")).toMatchObject({
      new: 5,
      posted: 0,
      pending: 5,
    });
    expect(await take("august.csv")).toMatchObject({ alreadyImported: true });
    const staged = await lines();
    expect(staged).toHaveLength(5);
    // The two identical coffees are two lines: the hash of the text, then
    // `#2` for the repeat, in the statement id and the external id alike.
    const coffees = staged.filter(
      (each) => each.descriptorKey === "mercado_exemplo",
    );
    expect(coffees.map((each) => each.statementId).sort()).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}#2$/),
    ]);
    for (const each of coffees)
      expect(each.paymentKey).toBe(`${each.externalId}-1/1`);
  });

  test("a card invoice is taken only into a CARD", async () => {
    const { run, finance } = await book();
    const bank = await finance("createAccount", {
      key: "bank",
      name: "Banco",
      type: "ACCOUNT",
    });
    await run("finance-imports.setMovementConsumer", {
      accountId: bank.id,
      type: TYPE,
      importerId: "c6/card",
    });
    await expect(
      run("finance-imports.importMovements", {
        accountId: bank.id,
        type: TYPE,
        key: "x.csv",
        content: fixture("august.csv"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("posting a purchase as an expense and its instalments", () => {
  test("a financed purchase is one expense settled into one invoice payment per instalment", async () => {
    const { take, classify, links, finance, card } = await book();
    await take("august.csv");
    expect((await classify("mp_vidracaria_exemplo")).posted).toBe(1);

    const { expenses, payments } = await links({ accountId: card.id });
    expect(expenses).toHaveLength(1);
    const { expense } = await finance<{ expense: Row }>("getExpense", {
      id: expenses[0]?.expenseId,
    });
    expect(expense).toMatchObject({ amount: "214998" });
    // Bought in June: instalments on the June, July and August invoices.
    expect(payments.map((each) => each.installmentNumber)).toEqual([1, 2, 3]);
    const keys = await Promise.all(
      payments.map(async (each) => {
        const { payment } = await finance<{ payment: Row }>("getPayment", {
          id: each.paymentId,
        });
        return payment.key;
      }),
    );
    expect(keys).toEqual([
      `card-${card.id}-2026-06`,
      `card-${card.id}-2026-07`,
      `card-${card.id}-2026-08`,
    ]);
    // Each invoice is due on its window's day; July has no window yet, so
    // June's due day is carried forward.
    const due = await Promise.all(
      payments.map(async (each) => {
        const { payment } = await finance<{ payment: Row }>("getPayment", {
          id: each.paymentId,
        });
        return payment.dueOn;
      }),
    );
    expect(due).toEqual(["2026-07-10", "2026-08-10", "2026-09-10"]);
    // This invoice showed instalment 3; the others are scheduled, not seen.
    expect(payments.map((each) => each.movementId === null)).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("every purchase billed in a month settles into that month's one payment", async () => {
    const { take, classify, links, finance, card } = await book();
    await take("august.csv");
    await classify("mp_vidracaria_exemplo");
    await classify("escola_exemplo");
    expect((await classify("mercado_exemplo")).posted).toBe(2);
    const { expenses, payments } = await links({ accountId: card.id });
    expect(expenses).toHaveLength(4);
    expect(payments).toHaveLength(3 + 12 + 1 + 1);
    const page = await finance<{ items: Row[] }>("listPayments", {
      accountId: card.id,
      limit: 100,
    });
    const invoice = page.items.find(
      (each) => each.key === `card-${card.id}-2026-08`,
    );
    // 716.66 + 362.08 + 12.00 + 12.00
    expect(invoice).toMatchObject({ amount: "110274", method: "CREDIT_CARD" });
  });

  test("the next invoice's instalment attaches to the one already scheduled", async () => {
    const { take, classify, links, lines, finance, window, card } =
      await book();
    await take("august.csv");
    await classify("escola_exemplo");
    await window("09", "30");
    expect(await take("september.csv")).toMatchObject({
      new: 3,
      posted: 1,
      pending: 2,
    });
    const school = await lines({ descriptorKey: "escola_exemplo" });
    expect(school.map((each) => each.status)).toEqual(["POSTED", "POSTED"]);
    const { expenses, payments } = await links({ accountId: card.id });
    expect(expenses).toHaveLength(1);
    expect(
      payments
        .filter((each) => each.movementId !== null)
        .map((each) => each.installmentNumber),
    ).toEqual([5, 6]);
    expect(
      (await finance<{ items: Row[] }>("listExpenses", {})).items,
    ).toHaveLength(1);
  });

  test("a purchase no billing window holds waits until one is registered", async () => {
    const { take, classify, lines, finance, window } = await book();
    await take("august.csv");
    await classify("escola_exemplo");
    await take("september.csv");
    const [distributor] = await lines({
      descriptorKey: "distribuidora_exemplo",
    });
    expect((await classify("distribuidora_exemplo")).posted).toBe(0);
    await expect(
      finance("postCardMovement", { id: distributor?.id }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await window("09", "30");
    const posted = await finance<{ movement: Card }>("postCardMovement", {
      id: distributor?.id,
    });
    expect(posted.movement.status).toBe("POSTED");
  });

  test("the invoice paid is a credit, not a purchase: it is ignored with a reason", async () => {
    const { take, classify, lines, finance } = await book();
    await take("august.csv");
    expect((await classify("pag_fatura_boleto")).posted).toBe(0);
    const [paid] = await lines({ descriptorKey: "pag_fatura_boleto" });
    await expect(
      finance("postCardMovement", { id: paid?.id }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      await finance("ignoreCardMovement", {
        id: paid?.id,
        reason: "pagamento da fatura",
      }),
    ).toMatchObject({ status: "IGNORED" });
  });

  test("a refund is a discount on the invoice it is billed on", async () => {
    const { take, classify, lines, finance, window, card, party } =
      await book();
    await take("august.csv");
    await classify("escola_exemplo");
    await window("09", "30");
    await take("september.csv");
    const refunds = await finance("createFinancialCategory", {
      name: "Estornos",
      kind: "EXPENSE",
      role: "DEDUCTION",
    });
    // A credit under an ordinary expense category is not a purchase.
    expect((await classify("estorno_mp_vidracaria_exemplo")).posted).toBe(0);
    const refunded = await finance<{ posted: number }>(
      "classifyCardMovementDescriptor",
      {
        accountId: card.id,
        descriptorKey: "estorno_mp_vidracaria_exemplo",
        partyId: party.id,
        financialCategoryId: refunds.id,
      },
    );
    expect(refunded.posted).toBe(1);
    const [refund] = await lines({
      descriptorKey: "estorno_mp_vidracaria_exemplo",
    });
    expect(refund?.status).toBe("POSTED");
    const expenses = await finance<{ items: Row[] }>("listExpenses", {});
    expect(expenses.items).toContainEqual(
      expect.objectContaining({
        amount: "-10000",
        financialCategoryId: refunds.id,
      }),
    );
    const page = await finance<{ items: Row[] }>("listPayments", {
      accountId: card.id,
      limit: 100,
    });
    // September: instalment 6/12 of 362.08 less the 100.00 refund.
    expect(
      page.items.find((each) => each.key === `card-${card.id}-2026-09`),
    ).toMatchObject({ amount: "26208" });

    await finance("undoCardMovement", { id: refund?.id });
    expect(
      (
        await finance<{ items: Row[] }>("listPayments", {
          accountId: card.id,
          limit: 100,
        })
      ).items.find((each) => each.key === `card-${card.id}-2026-09`),
    ).toMatchObject({ amount: "36208" });
  });

  test("the invoice paid from the C6 account is one transfer into the card, seen from both statements", async () => {
    const { run, finance, take, lines, links, card, sides } = await book();
    const c6 = await finance("createAccount", {
      key: "c6",
      name: "C6",
      type: "ACCOUNT",
      number: "12345678-9",
    });
    await run("finance-imports.setMovementConsumer", {
      accountId: c6.id,
      type: "account-movements",
      importerId: "c6/account",
    });
    await take("august.csv");
    const [paid] = await lines({ descriptorKey: "pag_fatura_boleto" });
    // The line says "Boleto", but only the descriptor names the method.
    expect(paid?.paymentMethod).toBeNull();
    const cardSide = await finance<{ posted: number }>(
      "classifyCardMovementDescriptor",
      {
        accountId: card.id,
        descriptorKey: "pag_fatura_boleto",
        counterAccountId: c6.id,
        paymentMethod: "BOLETO",
      },
    );
    expect(cardSide.posted).toBe(1);

    // The C6 statement shows the same 9,827.29 leaving on 10/08.
    await run("finance-imports.importMovements", {
      accountId: c6.id,
      type: "account-movements",
      key: "drive/extratos/c6/agosto.csv",
      content:
        "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)\n10/08/2026,10/08/2026,BANCO C6 S.A.,BANCO C6 S.A.,0.00,9827.29,59.42\n",
    });
    const [left] = (await sides.list<{ items: Row[] }>({ accountId: c6.id }))
      .items;
    expect(left?.paymentMethod).toBeNull();
    const accountSide = await sides.classify<{ posted: number }>({
      accountId: c6.id,
      direction: "PAYMENT",
      descriptorKey: left?.descriptorKey,
      counterAccountId: card.id,
      paymentMethod: "BOLETO",
    });
    expect(accountSide.posted).toBe(1);

    const key = `a${c6.id}-BOLETO-a${card.id}-20260810-982729`;
    expect(
      (
        await sides.links<{ items: Row[] }>({
          statementKey: key,
        })
      ).items,
    ).toHaveLength(1);
    expect((await links({ accountId: card.id })).transfers).toEqual([
      expect.objectContaining({ statementKey: key }),
    ]);
    expect(
      (await finance<{ items: Row[] }>("listTransfers", {})).items,
    ).toEqual([
      expect.objectContaining({
        sourceAccountId: c6.id,
        destinationAccountId: card.id,
        amount: "982729",
      }),
    ]);

    // Undoing the card side keeps the transfer the account side still links.
    await finance("undoCardMovement", { id: paid?.id });
    expect(
      (await finance<{ items: Row[] }>("listTransfers", {})).items,
    ).toHaveLength(1);
  });

  test("undo keeps the schedule while another line of the purchase is posted; the last one removes it", async () => {
    const { take, classify, links, lines, finance, window, card } =
      await book();
    await take("august.csv");
    await classify("escola_exemplo");
    await window("09", "30");
    await take("september.csv");
    const [sixth, fifth] = await lines({ descriptorKey: "escola_exemplo" });

    await finance("undoCardMovement", { id: sixth?.id });
    expect((await links({ accountId: card.id })).payments).toHaveLength(12);

    await finance("undoCardMovement", { id: fifth?.id });
    expect(await links({ accountId: card.id })).toEqual({
      expenses: [],
      payments: [],
      transfers: [],
    });
    expect(
      (await finance<{ items: unknown[] }>("listOpenExpenses", {})).items,
    ).toHaveLength(1);

    // Posting again reuses the expense and schedules it again.
    await finance("postCardMovement", { id: fifth?.id });
    expect((await links({ accountId: card.id })).payments).toHaveLength(12);
    expect(
      (await finance<{ items: Row[] }>("listExpenses", {})).items,
    ).toHaveLength(1);
  });
});
