/// <reference types="bun-types" />
/**
 * A parser from another package (ADR 11): a module that depends on
 * finance-imports and contributes an importer is read like the examples,
 * with no edit to this module.
 */
import { describe, expect, test } from "bun:test";
import type { FinanceApi } from "@lastro/finance";
import { financeTestHost } from "@lastro/finance/testing";
import { type ModuleDefinition, defineModule } from "@lastro/kernel";
import { financeImportsModule } from "..";
import { readCsvTable } from "../parsers/read";
import type { MovementImporter } from "./importer";

const exampleBank: MovementImporter = {
  id: "example/bank",
  version: 1,
  evidence: "account-movements",
  parse: (content) =>
    readCsvTable(content, {
      label: "Example bank statement",
      delimiter: ";",
      columns: ["Data", "Valor", "Id", "Descrição"] as const,
      row: (cell, line) => ({
        externalId: cell.optional("Id"),
        line,
        occurredOn: cell.date("Data"),
        occurredAt: null,
        amount: cell.money("Valor"),
        currency: "BRL",
        name: cell.text("Descrição"),
        description: cell.text("Descrição"),
      }),
    }),
};

const contributor = (importer: unknown) =>
  defineModule<null, { finance: FinanceApi }, object>({
    id: "example-bank-imports",
    dependsOn: ["core", "finance", "finance-imports"],
    operations: [],
    contributes: { "finance-imports": [importer] },
    create: () => ({ api: {}, handlers: [] }),
  });

const host = (extra: ModuleDefinition<null>) =>
  financeTestHost([
    financeImportsModule as unknown as ModuleDefinition<null>,
    extra,
  ]);

describe("contributed importers", () => {
  test("are listed and read the files their consumer routes to them", async () => {
    const { host: lastro, as } = host(contributor(exampleBank));
    const run = async <T = Record<string, unknown>>(
      id: string,
      input: unknown,
    ) => (await lastro.execute(id, as("editor"), input)) as T;
    const listed = await run<{ items: { id: string }[] }>(
      "finance-imports.listMovementImporters",
      {},
    );
    expect(listed.items.map((each) => each.id)).toContain("example/bank");

    const account = await run<{ id: string }>("finance.createAccount", {
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
    });
    await run("finance-imports.setMovementConsumer", {
      accountId: account.id,
      type: "account-movements",
      importerId: "example/bank",
    });
    const intake = await run<{ new: number; pending: number }>(
      "finance-imports.importMovements",
      {
        accountId: account.id,
        type: "account-movements",
        key: "example.csv",
        content:
          "Data;Valor;Id;Descrição\n06/01/2026;-12.50;a1;PADARIA EXEMPLO\n07/01/2026;30.00;;CLIENTE EXEMPLO\n",
      },
    );
    expect(intake).toMatchObject({ new: 2, pending: 2 });
  });

  test("refuse an item that is not an importer, at start-up", () => {
    expect(() => host(contributor({ id: "broken" }))).toThrow(
      "contributed statement importer broken needs",
    );
  });
});
