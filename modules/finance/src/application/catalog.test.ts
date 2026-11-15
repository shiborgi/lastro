/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ForbiddenError, UnauthorizedError } from "@lastro/kernel";
import { financeTestHost } from "../testing";
import type { FinanceApi } from "./module";

type Row = { id: string } & Record<string, unknown>;

function financeHost() {
  const test = financeTestHost();
  const run = (id: string, input: unknown, context = test.as("editor")) =>
    test.host.execute(`finance.${id}`, context, input);
  const row = async (id: string, input: unknown) =>
    (await run(id, input)) as Row;
  return { ...test, run, row };
}

describe("finance catalogs", () => {
  test("an account defaults its optional fields to null and is listed in its Book only", async () => {
    const { as, run, row } = financeHost();
    const bank = await row("createAccount", {
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
    });
    expect(bank).toEqual({
      id: "1",
      bookId: "1",
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
      institutionId: null,
      number: null,
    });
    expect(await run("listAccounts", {})).toEqual({ items: [bank] });
    expect(await run("listAccounts", {}, as("other", "2"))).toEqual({
      items: [],
    });
    // Another Book's record reads as not found.
    await expect(
      run("updateAccount", { id: bank.id, name: "x" }, as("other", "2")),
    ).rejects.toThrow(UnauthorizedError);
  });

  test("an account type outside the four is refused at the contract", async () => {
    const { run } = financeHost();
    await expect(
      run("createAccount", { key: "m", name: "Maquininha", type: "ACQUIRER" }),
    ).rejects.toThrow();
  });

  test("a viewer lists and cannot write", async () => {
    const { as, run } = financeHost();
    expect(await run("listParties", {}, as("viewer"))).toEqual({ items: [] });
    await expect(
      run("createInstitution", { key: "bank", name: "Bank" }, as("viewer")),
    ).rejects.toThrow(ForbiddenError);
  });

  test("a billing window takes calendar dates and answers with them", async () => {
    const { run, row } = financeHost();
    const card = await row("createAccount", {
      key: "card",
      name: "Card",
      type: "CARD",
    });
    const window = await row("createAccountCycle", {
      accountId: card.id,
      referenceMonth: "2026-11-01T00:00:00.000Z",
      startsOn: "2026-10-05",
      endsOn: "2026-11-04",
      dueOn: "2026-11-12",
    });
    expect(window).toMatchObject({
      referenceMonth: "2026-11-01",
      startsOn: "2026-10-05",
      endsOn: "2026-11-04",
    });
    expect(
      await run("updateAccountCycle", {
        id: window.id,
        endsOn: "2026-11-03",
      }),
    ).toMatchObject({ startsOn: "2026-10-05", endsOn: "2026-11-03" });
    expect(await run("listAccountCycles", { accountId: "99" })).toEqual({
      items: [],
    });
    await expect(
      run("createAccountCycle", {
        accountId: card.id,
        referenceMonth: "2026-12-01",
        startsOn: "2026-12-10",
        endsOn: "2026-12-01",
        dueOn: "2026-12-12",
      }),
    ).rejects.toThrow("startsOn must not be after endsOn");
    await expect(
      run("updateAccountCycle", {
        id: window.id,
        endsOn: "2026-02-30",
      }),
    ).rejects.toThrow();
  });

  test("financial categories filter by kind and delete answers once", async () => {
    const { run, row } = financeHost();
    const cost = await row("createFinancialCategory", {
      name: "Insumos",
      kind: "EXPENSE",
    });
    await run("createFinancialCategory", { name: "Vendas", kind: "REVENUE" });
    expect(await run("listFinancialCategories", { kind: "EXPENSE" })).toEqual({
      items: [cost],
    });
    expect(await run("deleteFinancialCategory", { id: cost.id })).toEqual({
      id: cost.id,
      deleted: true,
    });
    await expect(
      run("deleteFinancialCategory", { id: cost.id }),
    ).rejects.toThrow(UnauthorizedError);
  });

  test("dependents read the catalog inside their own scope", async () => {
    const { host, as, row } = financeHost();
    const bank = await row("createAccount", {
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
    });
    const finance = host.modules.finance as FinanceApi;
    const scope = { context: as("editor"), handle: null, audit: () => {} };
    expect(await finance.catalog.getAccount(scope, bank.id)).toMatchObject({
      key: "bank",
    });
    expect(await finance.catalog.getAccount(scope, "404")).toBeNull();
    expect(
      await finance.catalog.listAccounts({
        ...scope,
        context: as("other", "2"),
      }),
    ).toEqual([]);
  });
});
