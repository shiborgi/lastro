/// <reference types="bun-types" />
/**
 * The stone-account flow over memory: only the Pix the Stone account sends,
 * as payment movements; a descriptor naming another account of the Book makes
 * it a transfer the receiving statement joins by statement key
 * (docs/flows/stone-account.md).
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
    resolve(import.meta.dir, "../parsers/stone-account/fixtures", name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;
type AccountMovement = Row & {
  direction: "PAYMENT" | "RECEIPT";
  accountId: string;
  descriptorKey: string;
  status: string;
};

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
  const stone = await finance("createAccount", {
    key: "stone",
    name: "Stone",
    type: "ACCOUNT",
  });
  const c6 = await finance("createAccount", {
    key: "c6",
    name: "C6",
    type: "ACCOUNT",
  });
  for (const [account, importerId] of [
    [stone, "stone/account"],
    [c6, "c6/account"],
  ] as const)
    await run("finance-imports.setMovementConsumer", {
      accountId: account.id,
      type: "account-movements",
      importerId,
    });
  const take = (accountId: string, key: string, content: string) =>
    run<Row & { new: number; posted: number }>(
      "finance-imports.importMovements",
      { accountId, type: "account-movements", key, content },
    );
  const movements = async (query: Record<string, unknown> = {}) =>
    (await sides.list<{ items: AccountMovement[] }>(query)).items;
  return { run, finance, sides, take, movements, stone, c6 };
}

describe("taking the Stone account statement in", () => {
  test("each Pix sent is a payment movement, and the day's Pix sales one receipt movement, each the hash of its line", async () => {
    const { take, movements, stone } = await book();
    expect(
      await take(
        stone.id,
        "drive/stone/contas/extrato.csv",
        fixture("month.csv"),
      ),
    ).toMatchObject({ new: 3, posted: 0 });
    const staged = await movements({ accountId: stone.id });
    expect(staged.map((each) => each.direction).sort()).toEqual([
      "PAYMENT",
      "PAYMENT",
      "RECEIPT",
    ]);
    for (const each of staged)
      expect(each.externalId).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a Pix to the Book's C6 account is one transfer, joined by the C6 statement", async () => {
    const { take, movements, finance, stone, c6, sides } = await book();
    await take(
      stone.id,
      "drive/stone/contas/extrato.csv",
      fixture("month.csv"),
    );
    const [sent] = (await movements({ accountId: stone.id })).filter((each) =>
      each.descriptorKey.includes("empresa_exemplo"),
    );
    const classified = await sides.classify<{ posted: number }>({
      accountId: stone.id,
      direction: "PAYMENT",
      descriptorKey: sent?.descriptorKey,
      counterAccountId: c6.id,
      paymentMethod: "PIX",
    });
    expect(classified.posted).toBe(1);
    await take(
      c6.id,
      "drive/c6/conta/novembro.csv",
      "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)\n09/11/2026,09/11/2026,Pix recebido de EMPRESA EXEMPLO LTDA,Pix recebido de EMPRESA EXEMPLO LTDA,3009.75,0.00,3069.17\n",
    );
    const [arrived] = await movements({ accountId: c6.id });
    await sides.classify({
      accountId: c6.id,
      direction: "RECEIPT",
      descriptorKey: arrived?.descriptorKey,
      counterAccountId: stone.id,
      paymentMethod: "PIX",
    });
    const key = `a${stone.id}-PIX-a${c6.id}-20261109-300975`;
    expect(
      (
        await sides.links<{ items: Row[] }>({
          statementKey: key,
        })
      ).items,
    ).toHaveLength(2);
    expect(
      (await finance<{ items: Row[] }>("listTransfers", {})).items,
    ).toEqual([
      expect.objectContaining({
        sourceAccountId: stone.id,
        destinationAccountId: c6.id,
        amount: "300975",
      }),
    ]);
  });
});
