/// <reference types="bun-types" />
/**
 * The c6-account flow over memory: the same account movement family as
 * nubank-account (docs/flows/c6-account.md, ADR 17), with lines
 * identified by the hash of their text, and the Pix between C6 and Nubank
 * meeting as one transfer by statement key.
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

const fixture = (flow: string, name: string) =>
  readFileSync(
    resolve(import.meta.dir, `../parsers/${flow}/fixtures`, name),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;
type AccountMovement = Row & {
  direction: "PAYMENT" | "RECEIPT";
  accountId: string;
  externalId: string;
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
  for (const [account, importerId] of [
    [nubank, "nubank/account"],
    [c6, "c6/account"],
  ] as const)
    await run("finance-imports.setMovementConsumer", {
      accountId: account.id,
      type: "account-movements",
      importerId,
    });
  const take = (account: Row, flow: string, name: string) =>
    run<Row & { new: number; known: number; posted: number }>(
      "finance-imports.importMovements",
      {
        accountId: account.id,
        type: "account-movements",
        key: `drive/extratos/${flow}/${name}`,
        content: fixture(flow, name),
      },
    );
  const movements = async (query: Record<string, unknown> = {}) =>
    (await sides.list<{ items: AccountMovement[] }>(query)).items;
  const transferWith = (
    movement: AccountMovement | undefined,
    counterAccountId: string,
  ) =>
    sides.classify<{ posted: number }>({
      accountId: movement?.accountId,
      direction: movement?.direction,
      descriptorKey: movement?.descriptorKey,
      counterAccountId,
      paymentMethod: "PIX",
    });
  return { run, finance, sides, take, movements, transferWith, nubank, c6 };
}

describe("taking a C6 account statement in", () => {
  test("each line is its text's hash; identical lines and overlaps are never staged twice", async () => {
    const { take, movements, c6 } = await book();
    expect(await take(c6, "c6-account", "month.csv")).toMatchObject({
      new: 6,
      known: 0,
      posted: 0,
    });
    expect(await take(c6, "c6-account", "month.csv")).toMatchObject({
      alreadyImported: true,
    });
    expect(await take(c6, "c6-account", "overlap.csv")).toMatchObject({
      new: 1,
      known: 1,
    });
    const staged = await movements({ accountId: c6.id });
    expect(staged).toHaveLength(7);
    const supplier = staged
      .filter(
        (each) =>
          each.descriptorKey ===
          "pix_enviado_para_fornecedor_exemplo_transf_enviada_pix",
      )
      .map((each) => each.externalId);
    // Two different lines, and the second of two identical ones as `#2`.
    expect(supplier.filter((id) => /^[0-9a-f]{64}$/.test(id))).toHaveLength(2);
    expect(supplier.filter((id) => /^[0-9a-f]{64}#2$/.test(id))).toHaveLength(
      1,
    );
    // Money out is a payment movement, money in a receipt movement.
    expect(staged.filter((each) => each.direction === "RECEIPT")).toHaveLength(
      2,
    );
  });

  test("the Pix from C6 to Nubank is one transfer, seen from both statements", async () => {
    const { take, movements, transferWith, finance, nubank, c6, sides } =
      await book();
    await take(nubank, "nubank-account", "month.csv");
    await take(c6, "c6-account", "month.csv");
    const [arrived] = await movements({
      accountId: nubank.id,
      direction: "RECEIPT",
    });
    const [left] = (await movements({ accountId: c6.id })).filter(
      (each) =>
        each.descriptorKey ===
        "pix_enviado_para_empresa_exemplo_ltda_transf_enviada_pix",
    );
    expect((await transferWith(arrived, c6.id)).posted).toBe(1);
    expect((await transferWith(left, nubank.id)).posted).toBe(1);

    const key = `a${c6.id}-PIX-a${nubank.id}-20260106-16500`;
    const links = await sides.links<{ items: Row[] }>({
      statementKey: key,
    });
    expect(links.items).toHaveLength(2);
    expect(
      (await finance<{ items: Row[] }>("listTransfers", {})).items,
    ).toEqual([
      expect.objectContaining({
        sourceAccountId: c6.id,
        destinationAccountId: nubank.id,
        amount: "16500",
      }),
    ]);
  });
});
