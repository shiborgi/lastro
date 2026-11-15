import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  paymentMovementLinks,
  paymentMovements,
  payments,
} from "@lastro/finance/db";
/// <reference types="bun-types" />
/*
 * The nubank-account flow on the real database (docs/flows/nubank-account.md,
 * ADRs 14 and 17): a consumer per account and type, intake through
 * finance-imports, replay by content and by idempotency key, overlap,
 * posting at intake and by classification, transfers joined by statement key,
 * undo, and the rules the tables hold for any caller.
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
  "../../../../modules/finance-imports/src/parsers/nubank-account/fixtures",
);
const fixture = (name: string) => readFileSync(resolve(FIXTURES, name), "utf8");

type Row = { id: string } & Record<string, unknown>;
type Movement = Row & {
  direction: "PAYMENT" | "RECEIPT";
  accountId: string;
  status: string;
  descriptorKey: string;
  description: string;
};
type Link = Row & {
  movementId: string;
  statementKey: string;
  transferId: string | null;
  paymentId: string | null;
};

const TYPE = "account-movements";

async function bar() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = async <T = Row>(id: string, input: unknown, key?: string) =>
    (await host.execute(
      id,
      seeded.as("EDITOR", key ? { idempotencyKey: key } : {}),
      input,
    )) as T;
  const sides = accountMovementSides(run);
  const nubank = await run("finance.createAccount", {
    key: "nubank",
    name: "Nubank",
    type: "ACCOUNT",
    number: "987654321",
  });
  const c6 = await run("finance.createAccount", {
    key: "c6",
    name: "C6",
    type: "ACCOUNT",
    number: "12345678-9",
  });
  const supplier = await run("finance.createParty", {
    key: "fornecedor",
    name: "Fornecedor",
    type: "COMPANY",
  });
  const supplies = await run("finance.createFinancialCategory", {
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
  const take = (
    name: string,
    key?: string,
    content = fixture(name),
    accountId = nubank.id,
  ) =>
    run<
      Row & {
        posted: number;
        new: number;
        known: number;
        alreadyImported: boolean;
        file: Row;
      }
    >(
      "finance-imports.importMovements",
      {
        accountId,
        type: TYPE,
        key: `drive/extratos/nubank/${name}`,
        content,
      },
      key,
    );
  const movements = async (query: Record<string, unknown> = {}) =>
    (await sides.list<{ items: Movement[] }>(query)).items;
  /* A name's descriptor says the other end is this own account. */
  const transferWith = (
    movement: Movement | undefined,
    counterAccountId: string,
  ) =>
    sides.classify<{ posted: number }>({
      accountId: movement?.accountId,
      direction: movement?.direction,
      descriptorKey: movement?.descriptorKey,
      counterAccountId,
      paymentMethod: "PIX",
    });
  const links = async (query: Record<string, unknown>) =>
    (await sides.links<{ items: Link[] }>(query)).items;
  return {
    bookId: Number(seeded.book.id),
    run,
    sides,
    consume,
    take,
    movements,
    transferWith,
    links,
    nubank,
    c6,
    supplier,
    supplies,
  };
}

const C6_SIDE =
  "Data,Valor,Identificador,Descrição\n06/01/2026,-165.00,c6-0001,Transferência enviada pelo Pix - EMPRESA EXEMPLO LTDA - 00.000.000/0001-00 - NU PAGAMENTOS (0260) Agência: 1 Conta: 987654321\n";

describe("a Nubank month on PostgreSQL", () => {
  test("sending the content twice, or content that overlaps it, never stages a line twice", async () => {
    const { take, movements } = await bar();
    const first = await take("month.csv", "nubank-month");
    expect(first).toMatchObject({ alreadyImported: false, new: 3, posted: 0 });
    expect(await take("month.csv", "nubank-month")).toEqual(first);
    expect(await take("month.csv", "nubank-month-again")).toMatchObject({
      alreadyImported: true,
      file: { id: first.file.id },
    });
    expect(await take("overlap.csv")).toMatchObject({ new: 1, known: 1 });
    expect(await movements()).toHaveLength(4);
    await expect(take("changed.csv")).rejects.toMatchObject({
      code: "MOVEMENT_CONFLICT",
    });
  });

  test("descriptors naming the other account make both sides one transfer, joined by statement key; undo keeps what the other side links", async () => {
    const {
      take,
      movements,
      transferWith,
      links,
      run,
      consume,
      c6,
      nubank,
      sides,
    } = await bar();
    await take("month.csv");
    const [incoming] = await movements({ direction: "RECEIPT" });
    expect(incoming).toMatchObject({ status: "PENDING" });
    expect((await transferWith(incoming, c6.id)).posted).toBe(1);
    const key = `a${c6.id}-PIX-a${nubank.id}-20260106-16500`;
    await consume(c6.id);
    expect((await take("c6.csv", undefined, C6_SIDE, c6.id)).pending).toBe(1);
    const [pending] = await movements({ accountId: c6.id });
    expect((await transferWith(pending, nubank.id)).posted).toBe(1);
    const both = await links({ statementKey: key });
    expect(both.map((each) => each.direction).sort()).toEqual([
      "PAYMENT",
      "RECEIPT",
    ]);
    const transfers = await run<{ items: Row[] }>("finance.listTransfers", {});
    expect(transfers.items).toEqual([
      expect.objectContaining({
        id: both[0]?.transferId,
        sourceAccountId: c6.id,
        destinationAccountId: nubank.id,
        amount: "16500",
        occurredOn: "2026-01-06",
      }),
    ]);
    await sides.undo({ id: incoming?.id });
    expect(
      (await run<{ items: Row[] }>("finance.listTransfers", {})).items,
    ).toHaveLength(1);
    const [outgoing] = await movements({ accountId: c6.id });
    await sides.undo({ id: outgoing?.id });
    expect(
      (await run<{ items: Row[] }>("finance.listTransfers", {})).items,
    ).toEqual([]);
  });

  test("classifying a descriptor pays its lines from the account, then later contents on their own", async () => {
    const { take, movements, links, run, supplier, supplies, nubank, sides } =
      await bar();
    await take("month.csv");
    const pix = (await movements({ status: "PENDING" })).find((each) =>
      each.descriptorKey.includes("fornecedor_exemplo"),
    );
    const classified = await sides.classify<{ posted: number }>({
      accountId: pix?.accountId,
      direction: pix?.direction,
      descriptorKey: pix?.descriptorKey,
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      paymentMethod: "PIX",
    });
    expect(classified.posted).toBe(1);
    expect(await take("overlap.csv")).toMatchObject({ new: 1, posted: 1 });

    const posted = await movements({ direction: "PAYMENT", status: "POSTED" });
    expect(posted).toHaveLength(2);
    for (const movement of posted) {
      const [link] = await links({ movementId: movement.id });
      const { payment } = await run<{ payment: Row }>("finance.getPayment", {
        id: link?.paymentId,
      });
      expect(payment).toMatchObject({
        accountId: nubank.id,
        amount: movement.amount,
        method: "PIX",
      });
    }
    const audit = await run<{ items: { action: string }[] }>(
      "core.listAuditEvents",
      { limit: 100 },
    );
    const actions = audit.items.map((each) => each.action);
    expect(actions).toContain("statement_consumer.set");
    expect(actions).toContain("movement_file.imported");
    expect(actions).toContain("movement_descriptor.classified");
    expect(actions.filter((each) => each === "movement.posted").length).toBe(2);
  });
});

describe("a C6 account month on PostgreSQL", () => {
  test("lines without an id are their text's hash; the Pix to Nubank joins the Nubank side's transfer", async () => {
    const { run, take, movements, transferWith, links, c6, nubank } =
      await bar();
    await run("finance-imports.setMovementConsumer", {
      accountId: c6.id,
      type: TYPE,
      importerId: "c6/account",
    });
    const c6Month = readFileSync(
      resolve(FIXTURES, "../../c6-account/fixtures/month.csv"),
      "utf8",
    );
    expect(await take("c6-month.csv", undefined, c6Month, c6.id)).toMatchObject(
      { new: 6, posted: 0 },
    );
    expect(await take("c6-month.csv", undefined, c6Month, c6.id)).toMatchObject(
      { alreadyImported: true },
    );
    const staged = await movements({ accountId: c6.id });
    expect(
      staged.every((each) =>
        /^[0-9a-f]{64}(#\d+)?$/.test(String(each.externalId)),
      ),
    ).toBe(true);

    await take("month.csv");
    const [arrived] = await movements({
      accountId: nubank.id,
      direction: "RECEIPT",
    });
    const [left] = staged.filter(
      (each) =>
        each.descriptorKey ===
        "pix_enviado_para_empresa_exemplo_ltda_transf_enviada_pix",
    );
    await transferWith(arrived, c6.id);
    expect((await transferWith(left, nubank.id)).posted).toBe(1);
    expect(
      await links({
        statementKey: `a${c6.id}-PIX-a${nubank.id}-20260106-16500`,
      }),
    ).toHaveLength(2);
  });
});

describe("the movement tables hold their rules for any caller", () => {
  test("a movement is POSTED only with links adding up to its amount", async () => {
    const { take, movements, bookId } = await bar();
    await take("month.csv");
    const pending = (await movements({ status: "PENDING" }))[0];
    await expectPgError(
      db
        .update(paymentMovements)
        .set({ status: "POSTED" })
        .where(
          and(
            eq(paymentMovements.bookId, bookId),
            eq(paymentMovements.id, Number(pending?.id)),
          ),
        ),
      "23514",
    );
  });

  test("a link names a payment of its movement's account and a well-formed statement key", async () => {
    const { take, movements, bookId, c6, run, supplier, supplies } =
      await bar();
    await take("month.csv");
    const expense = await run("finance.createExpense", {
      key: "nf-1",
      partyId: supplier.id,
      financialCategoryId: supplies.id,
      amount: "100",
      currency: "BRL",
      referenceMonth: "2026-01-01",
    });
    const pending = (await movements({ status: "PENDING" }))[0];
    const [foreign] = await db
      .insert(payments)
      .values({
        bookId,
        accountId: Number(c6.id),
        currency: "BRL",
        referenceMonth: new Date("2026-01-01T00:00:00Z"),
      })
      .returning();
    const link = {
      bookId,
      movementId: Number(pending?.id),
      amount: 100n,
      externalKey: "a1-test",
      cashId: foreign?.id,
      cashKey: "a1-test-payment",
      entryId: Number(expense.id),
      entryKey: "a1-test-1",
    };
    await expectPgError(
      db
        .insert(paymentMovementLinks)
        .values({ ...link, statementKey: "a1-PIX-p1-20260106-100" }),
      "23514",
    );
    await expectPgError(
      db
        .insert(paymentMovementLinks)
        .values({ ...link, statementKey: "a1-p1-20260106-100" }),
      "23514",
    );
  });

  test("a movement joins a transfer only from its own side", async () => {
    const { take, movements, transferWith, links, bookId, c6 } = await bar();
    await take("month.csv");
    const [incoming] = await movements({ direction: "RECEIPT" });
    await transferWith(incoming, c6.id);
    const [outgoing] = await movements({ direction: "PAYMENT" });
    const [link] = await links({ movementId: incoming?.id });
    // The transfer runs C6 → Nubank; a Nubank outflow is not its source.
    await expectPgError(
      db.insert(paymentMovementLinks).values({
        bookId,
        movementId: Number(outgoing?.id),
        externalKey: "a1-test",
        statementKey: String(link?.statementKey),
        amount: 16500n,
        transferId: Number(link?.transferId),
      }),
      "23514",
    );
  });
});
