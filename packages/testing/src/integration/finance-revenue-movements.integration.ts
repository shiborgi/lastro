/// <reference types="bun-types" />
/*
 * The yooga-payments flow on the real database (docs/flows/yooga-payments.md,
 * ADR 19): a day's report taken into the till, a record posted as its gross,
 * discount and fee revenues, and the rule the tables hold for any caller.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { revenueMovements } from "@lastro/finance/db";
import { createHost } from "@lastro/host";
import { and, eq } from "drizzle-orm";
import { expectPgError } from "../compose";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

const fixture = (name: string, parser = "yooga-payments") =>
  readFileSync(
    resolve(
      import.meta.dir,
      `../../../../modules/finance-imports/src/parsers/${parser}/fixtures`,
      name,
    ),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;

async function till() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = async <T = Row>(id: string, input: unknown) =>
    (await host.execute(id, seeded.as("EDITOR"), input)) as T;
  const account = await run("finance.createAccount", {
    key: "caixa",
    name: "Caixa",
    type: "CASH",
  });
  const party = await run("finance.createParty", {
    key: "clientes",
    name: "Clientes",
    type: "COMPANY",
  });
  const category = (name: string, role?: string) =>
    run("finance.createFinancialCategory", {
      name,
      kind: "REVENUE",
      ...(role ? { role } : {}),
    });
  const sales = await category("Vendas");
  const service = await category("Taxa de serviço");
  const discounts = await category("Descontos concedidos", "DEDUCTION");
  await run("finance-imports.setMovementConsumer", {
    accountId: account.id,
    type: "revenue-movements",
    importerId: "yooga/payments",
  });
  const classify = (descriptorKey: string, financialCategoryId: string) =>
    run<{ posted: number }>("finance.classifyRevenueMovementDescriptor", {
      accountId: account.id,
      descriptorKey,
      partyId: party.id,
      financialCategoryId,
    });
  await run("finance-imports.importMovements", {
    accountId: account.id,
    type: "revenue-movements",
    key: "drive/yooga/pagamentos/pagamentos-2026-11-08.csv",
    content: fixture("day.csv"),
  });
  return {
    bookId: Number(seeded.book.id),
    run,
    classify,
    account,
    sales,
    service,
    discounts,
  };
}

describe("a Yooga payments day on PostgreSQL", () => {
  test("the Pix record posts as three revenues found by its external key", async () => {
    const { run, classify, sales, service, discounts } = await till();
    await classify("pix_bruto", sales.id);
    await classify("pix_desconto", discounts.id);
    expect((await classify("pix_taxa", service.id)).posted).toBe(1);
    const [pix] = (
      await run<{ items: Row[] }>("finance.listRevenueMovements", {
        methodKey: "pix",
      })
    ).items;
    const externalKey = String(pix?.externalId);
    const links = await run<{
      items: { revenueKey: string; revenueId: string }[];
    }>("finance.listRevenueMovementLinks", { externalKey });
    expect(links.items.map((each) => each.revenueKey).sort()).toEqual([
      `${externalKey}-bruto`,
      `${externalKey}-desconto`,
      `${externalKey}-taxa`,
    ]);
    const revenues = await run<{ items: Row[] }>("finance.listRevenues", {});
    expect(
      revenues.items
        .filter((each) => String(each.key).startsWith(externalKey))
        .map((each) => each.amount)
        .sort(),
    ).toEqual(["-200", "1260", "13495"]);
  });

  test("a record is POSTED only with one revenue per component", async () => {
    const { run, bookId } = await till();
    const [record] = (
      await run<{ items: Row[] }>("finance.listRevenueMovements", {})
    ).items;
    await expectPgError(
      db
        .update(revenueMovements)
        .set({ status: "POSTED" })
        .where(
          and(
            eq(revenueMovements.bookId, bookId),
            eq(revenueMovements.id, Number(record?.id)),
          ),
        ),
      "23514",
    );
  });

  test("a Stone record posts only the acquirer's fee, and cannot link a gross", async () => {
    const seeded = await seedBook(db, ["EDITOR"]);
    const run = async <T = Row>(id: string, input: unknown) =>
      (await host.execute(id, seeded.as("EDITOR"), input)) as T;
    const stone = await run("finance.createAccount", {
      key: "stone",
      name: "Stone",
      type: "ACCOUNT",
    });
    const party = await run("finance.createParty", {
      key: "stone",
      name: "Stone",
      type: "COMPANY",
    });
    const fees = await run("finance.createFinancialCategory", {
      name: "Taxas de adquirente",
      kind: "REVENUE",
      role: "DEDUCTION",
    });
    await run("finance-imports.setMovementConsumer", {
      accountId: stone.id,
      type: "revenue-movements",
      importerId: "stone/sales",
    });
    await run("finance-imports.importMovements", {
      accountId: stone.id,
      type: "revenue-movements",
      key: "drive/stone/vendas/november.csv",
      content: fixture("november.csv", "stone-sales"),
    });
    expect(
      (
        await run<{ posted: number }>(
          "finance.classifyRevenueMovementDescriptor",
          {
            accountId: stone.id,
            descriptorKey: "debito_mastercard_taxa_adquirente",
            partyId: party.id,
            financialCategoryId: fees.id,
          },
        )
      ).posted,
    ).toBe(1);
    const [debit] = (
      await run<{ items: Row[] }>("finance.listRevenueMovements", {
        methodKey: "debito_mastercard",
      })
    ).items;
    expect(debit).toMatchObject({ status: "POSTED", grossRecognized: false });
    const revenues = await run<{ items: Row[] }>("finance.listRevenues", {});
    expect(
      revenues.items
        .filter((each) =>
          String(each.key).startsWith(String(debit?.externalId)),
        )
        .map((each) => each.amount),
    ).toEqual(["-124"]);
  });
});
