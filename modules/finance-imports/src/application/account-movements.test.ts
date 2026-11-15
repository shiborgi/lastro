/// <reference types="bun-types" />
/**
 * The nubank-account flow through the real envelope over memory: consumers
 * picked by account and type, intake, replay, overlap, descriptors that post
 * on their own, links with statement keys, transfers joined from both sides,
 * posting against existing expenses, and undo (docs/flows/nubank-account.md,
 * ADR 17).
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
    resolve(import.meta.dir, "../parsers/nubank-account/fixtures", name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;
type Intake = {
  file: Row;
  alreadyImported: boolean;
  lines: number;
  new: number;
  known: number;
  posted: number;
  pending: number;
};
type AccountMovement = Row & {
  direction: "PAYMENT" | "RECEIPT";
  accountId: string;
  status: string;
  descriptorKey: string;
  description: string;
  paymentMethod: string | null;
  counterAccountId: string | null;
};
type Link = Row & {
  movementId: string;
  statementKey: string;
  transferId: string | null;
  expenseId: string | null;
  paymentId: string | null;
};

const TYPE = "account-movements";

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
  const nubank = await finance("createAccount", {
    key: "nubank",
    name: "Nubank",
    type: "ACCOUNT",
    number: "987654321",
  });
  const c6 = await finance("createAccount", {
    key: "c6",
    name: "C6",
    type: "ACCOUNT",
    number: "12345678-9",
  });
  const supplier = await finance("createParty", {
    key: "fornecedor",
    name: "Fornecedor",
    type: "COMPANY",
  });
  const supplies = await finance("createFinancialCategory", {
    name: "Insumos",
    kind: "EXPENSE",
  });
  const consume = (accountId: string) =>
    run("finance-imports.setMovementConsumer", {
      accountId,
      type: TYPE,
      importerId: "nubank/account",
    });
  await consume(nubank.id);
  const take = (name: string, content = fixture(name), accountId = nubank.id) =>
    run<Intake>("finance-imports.importMovements", {
      accountId,
      type: TYPE,
      key: `drive/extratos/nubank/${name}`,
      content,
    });
  const movements = async (query: Record<string, unknown> = {}) =>
    (await sides.list<{ items: AccountMovement[] }>(query)).items;
  const links = async (query: Record<string, unknown>) =>
    (await sides.links<{ items: Link[] }>(query)).items;
  const ref = (movement: AccountMovement) => ({
    accountId: movement.accountId,
    direction: movement.direction,
    descriptorKey: movement.descriptorKey,
  });
  return {
    run,
    finance,
    sides,
    consume,
    take,
    movements,
    links,
    ref,
    nubank,
    c6,
    supplier,
    supplies,
  };
}

describe("the account and type pick the consumer", () => {
  test("content for an account with no consumer of that type is refused", async () => {
    const { run, c6 } = await book();
    await expect(
      run("finance-imports.importMovements", {
        accountId: c6.id,
        type: TYPE,
        key: "x.csv",
        content: fixture("month.csv"),
      }),
    ).rejects.toMatchObject({ code: "NO_CONSUMER" });
  });

  test("a consumer names a known importer of the same type", async () => {
    const { run, c6 } = await book();
    await expect(
      run("finance-imports.setMovementConsumer", {
        accountId: c6.id,
        type: "card-movements",
        importerId: "nubank/account",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      run("finance-imports.setMovementConsumer", {
        accountId: c6.id,
        type: TYPE,
        importerId: "nubank/cartao",
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN_IMPORTER" });
    const listed = await run<{ items: Row[] }>(
      "finance-imports.listMovementConsumers",
      {},
    );
    expect(listed.items).toEqual([
      expect.objectContaining({
        movementType: TYPE,
        importerId: "nubank/account",
      }),
    ]);
  });
});

describe("taking a Nubank statement in", () => {
  test("stages each line once, splits by sign, and replays without writing", async () => {
    const { take, movements, finance } = await book();
    const first = await take("month.csv");
    expect(first).toMatchObject({
      alreadyImported: false,
      lines: 3,
      new: 3,
      known: 0,
    });
    expect(first.file).toMatchObject({
      movementType: TYPE,
      importerId: "nubank/account",
      sourceKey: "drive/extratos/nubank/month.csv",
    });

    const again = await take("month.csv");
    expect(again.alreadyImported).toBe(true);
    expect(again.file.id).toBe(first.file.id);
    expect(await movements()).toHaveLength(3);

    expect(await take("overlap.csv")).toMatchObject({
      lines: 2,
      new: 1,
      known: 1,
    });
    const all = await movements();
    expect(all.filter((each) => each.direction === "PAYMENT")).toHaveLength(3);
    expect(all.filter((each) => each.direction === "RECEIPT")).toHaveLength(1);
    expect(
      all.some((each) => each.descriptorKey.includes("fornecedor_exemplo")),
    ).toBe(true);

    const files = await finance<{ items: Row[] }>("listMovementFiles", {});
    expect(files.items).toHaveLength(2);
  });

  test("a line whose amount changed refuses the whole content", async () => {
    const { take, movements } = await book();
    await take("month.csv");
    await expect(take("changed.csv")).rejects.toMatchObject({
      code: "MOVEMENT_CONFLICT",
    });
    expect(await movements()).toHaveLength(3);
  });

  test("malformed content is refused before anything is written", async () => {
    const { take, finance } = await book();
    await expect(take("malformed.csv")).rejects.toMatchObject({
      code: "IMPORT_FORMAT",
    });
    expect(
      (await finance<{ items: Row[] }>("listMovementFiles", {})).items,
    ).toEqual([]);
  });
});

describe("posting what is fully mapped", () => {
  test("a new name waits; its descriptor naming the C6 account makes it a transfer the C6 side joins by statement key", async () => {
    const { take, movements, links, finance, consume, ref, c6, nubank, sides } =
      await book();
    expect(await take("month.csv")).toMatchObject({ posted: 0, pending: 3 });
    const [incoming] = await movements({ direction: "RECEIPT" });
    if (!incoming) throw new Error("fixture line missing");
    expect(incoming).toMatchObject({
      status: "PENDING",
      counterAccountId: null,
    });

    const nubankSide = await sides.classify<{ posted: number }>({
      ...ref(incoming),
      counterAccountId: c6.id,
      paymentMethod: "PIX",
    });
    expect(nubankSide.posted).toBe(1);
    const key = `a${c6.id}-PIX-a${nubank.id}-20260106-16500`;
    const [link] = await links({ movementId: incoming.id });
    expect(link?.statementKey).toBe(key);

    // The C6 statement shows the same Pix leaving; once its descriptor names
    // the Nubank account, it finds the transfer by key.
    await consume(c6.id);
    const c6Content =
      "Data,Valor,Identificador,Descrição\n06/01/2026,-165.00,c6-0001,Transferência enviada pelo Pix - EMPRESA EXEMPLO LTDA - 00.000.000/0001-00 - NU PAGAMENTOS (0260) Agência: 1 Conta: 987654321\n";
    expect((await take("c6.csv", c6Content, c6.id)).pending).toBe(1);
    const [outgoing] = await movements({ accountId: c6.id });
    if (!outgoing) throw new Error("C6 line missing");
    const c6Side = await sides.classify<{ posted: number }>({
      ...ref(outgoing),
      counterAccountId: nubank.id,
      paymentMethod: "PIX",
    });
    expect(c6Side.posted).toBe(1);
    const both = await links({ statementKey: key });
    expect(both).toHaveLength(2);
    expect(new Set(both.map((each) => each.transferId)).size).toBe(1);
    expect(
      (await finance<{ items: Row[] }>("listTransfers", {})).items,
    ).toEqual([
      expect.objectContaining({
        sourceAccountId: c6.id,
        destinationAccountId: nubank.id,
        amount: "16500",
      }),
    ]);

    // Later contents with the same names post on their own.
    const later = await take(
      "later.csv",
      "Data,Valor,Identificador,Descrição\n08/01/2026,50.00,00000000-0000-4000-8000-000000000009,Transferência recebida pelo Pix - EMPRESA EXEMPLO LTDA - 00.000.000/0001-00 - BCO C6 S.A. (0336) Agência: 1 Conta: 12345678-9\n",
    );
    expect(later.posted).toBe(1);

    // Undoing one side keeps the transfer the other still links.
    await sides.undo({ id: incoming.id });
    expect(
      (await finance<{ items: Row[] }>("listTransfers", {})).items,
    ).toHaveLength(2);
    expect(await links({ statementKey: key })).toHaveLength(1);
  });

  test("classifying a descriptor posts its pending lines, and later contents post on their own", async () => {
    const { take, movements, links, finance, ref, supplier, supplies, sides } =
      await book();
    await take("month.csv");
    const [pix] = (await movements({ status: "PENDING" })).filter((each) =>
      each.descriptorKey.includes("fornecedor_exemplo"),
    );
    if (!pix) throw new Error("fixture line missing");

    const classified = await sides.classify<{ posted: number }>({
      ...ref(pix),
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      paymentMethod: "PIX",
    });
    expect(classified.posted).toBe(1);
    expect(await take("overlap.csv")).toMatchObject({
      new: 1,
      posted: 1,
      pending: 0,
    });

    const posted = await movements({ status: "POSTED", direction: "PAYMENT" });
    expect(posted).toHaveLength(2);
    expect(
      (await finance<{ items: unknown[] }>("listOpenExpenses", {})).items,
    ).toEqual([]);
    const [link] = await links({ movementId: posted[0]?.id });
    expect(link?.statementKey).toMatch(
      new RegExp(`^a\\d+-PIX-p${supplier.id}-20260109-8990$`),
    );
    const payment = await finance<{ payment: Row }>("getPayment", {
      id: link?.paymentId,
    });
    expect(payment.payment).toMatchObject({ amount: "8990", method: "PIX" });
  });

  test("a line with no payment method waits until one is known", async () => {
    const { take, movements, ref, supplier, supplies, sides } = await book();
    await take("month.csv");
    const [invoice] = (await movements({ status: "PENDING" })).filter(
      (each) => each.description === "Pagamento de fatura",
    );
    if (!invoice) throw new Error("fixture line missing");
    expect(invoice.paymentMethod).toBeNull();

    const partial = await sides.classify<{ posted: number }>({
      ...ref(invoice),
      partyId: supplier.id,
      financialCategoryId: supplies.id,
    });
    expect(partial.posted).toBe(0);
    await expect(sides.post({ id: invoice.id })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });

    const complete = await sides.classify<{ posted: number }>({
      ...ref(invoice),
      paymentMethod: "BOLETO",
    });
    expect(complete.posted).toBe(1);
    const [posted] = await movements({
      status: "POSTED",
      direction: "PAYMENT",
    });
    expect(posted).toMatchObject({ id: invoice.id, paymentMethod: "BOLETO" });
  });

  test("a line pays existing expenses: one payment, one link per expense", async () => {
    const { take, movements, links, finance, supplier, supplies, sides } =
      await book();
    const expense = (amount: string, key: string) =>
      finance("createExpense", {
        key,
        partyId: supplier.id,
        financialCategoryId: supplies.id,
        amount,
        currency: "BRL",
        referenceMonth: "2026-01-01",
      });
    const first = await expense("100000", "nf-1");
    const second = await expense("36401", "nf-2");
    await take("month.csv");
    const [pix] = (await movements({ status: "PENDING" })).filter((each) =>
      each.descriptorKey.includes("fornecedor_exemplo"),
    );
    await expect(
      sides.post({
        id: pix?.id,
        expenses: [{ expenseId: first.id, amount: "100000" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    const posted = await sides.post<{ links: Link[] }>({
      id: pix?.id,
      paymentMethod: "PIX",
      expenses: [
        { expenseId: first.id, amount: "100000" },
        { expenseId: second.id, amount: "36401" },
      ],
    });
    expect(posted.links.map((each) => each.expenseId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(new Set(posted.links.map((each) => each.paymentId)).size).toBe(1);
    expect(
      (await finance<{ items: unknown[] }>("listOpenExpenses", {})).items,
    ).toEqual([]);

    await sides.undo({ id: pix?.id });
    expect(await links({ movementId: pix?.id })).toEqual([]);
    expect(
      (await finance<{ items: unknown[] }>("listOpenExpenses", {})).items,
    ).toHaveLength(2);
  });

  test("posting by hand remembers the mapping; undo returns the line and reuses the expense", async () => {
    const { take, movements, finance, supplier, supplies, sides } =
      await book();
    await take("month.csv");
    const [invoice] = (await movements({ status: "PENDING" })).filter(
      (each) => each.description === "Pagamento de fatura",
    );
    if (!invoice) throw new Error("fixture line missing");

    const posted = await sides.post<{ movement: AccountMovement }>({
      id: invoice.id,
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      paymentMethod: "BOLETO",
    });
    expect(posted.movement.status).toBe("POSTED");
    const descriptors = await sides.descriptors<{ items: Row[] }>({
      classified: "true",
    });
    expect(descriptors.items).toEqual([
      expect.objectContaining({
        descriptorKey: "pagamento_de_fatura",
        paymentMethod: "BOLETO",
      }),
    ]);

    const undone = await sides.undo<AccountMovement>({ id: invoice.id });
    expect(undone.status).toBe("PENDING");
    expect(
      (await finance<{ items: unknown[] }>("listOpenExpenses", {})).items,
    ).toHaveLength(1);

    await sides.post({ id: invoice.id });
    expect(
      (await finance<{ items: unknown[] }>("listOpenExpenses", {})).items,
    ).toEqual([]);
    expect(
      (await finance<{ items: Row[] }>("listExpenses", {})).items,
    ).toHaveLength(1);
  });

  test("an ignored line keeps its reason and can be restored", async () => {
    const { take, movements, sides } = await book();
    await take("month.csv");
    const [line] = await movements({ status: "PENDING" });
    if (!line) throw new Error("fixture line missing");
    const ignored = await sides.ignore<AccountMovement>({
      id: line.id,
      reason: "devolvido no mesmo dia",
    });
    expect(ignored).toMatchObject({
      status: "IGNORED",
      ignoreReason: "devolvido no mesmo dia",
    });
    await expect(sides.post({ id: line.id })).rejects.toMatchObject({
      code: "MOVEMENT_STATE",
    });
    const restored = await sides.undo<AccountMovement>({ id: line.id });
    expect(restored).toMatchObject({ status: "PENDING", ignoreReason: null });
  });

  test("a descriptor refuses a financial category of the wrong kind", async () => {
    const { take, movements, ref, supplier, supplies, sides } = await book();
    await take("month.csv");
    const [incoming] = await movements({ direction: "RECEIPT" });
    if (!incoming) throw new Error("fixture line missing");
    await expect(
      sides.classify({
        ...ref(incoming),
        partyId: supplier.id,
        financialCategoryId: supplies.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
