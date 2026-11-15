/// <reference types="bun-types" />
/**
 * A day's card sales from sale to cash over memory (ADRs 19 and 20):
 * Yooga's payments report recognizes the gross, the discount and the tip;
 * Stone's sales add its fee; Stone's deposit, a promise, is one receipt that
 * settles those revenues; the C6 line for the same money pays it.
 */
import { describe, expect, test } from "bun:test";
import type { FinanceApi } from "@lastro/finance";
import { accountMovementSides, financeTestHost } from "@lastro/finance/testing";
import { defineModule } from "@lastro/kernel";
import { financeImportsOperations } from "../contracts";
import { movementImporters } from "../parsers";
import { createFinanceImports } from "./module";

type Row = { id: string } & Record<string, unknown>;

const YOOGA = `data;forma_pagamento;quantidade;bruto;desconto;acrescimo;valor
2026-01-06;Débito;2;110.00;10.00;0.00;100.00
2026-01-06;TOTAL;2;110.00;10.00;0.00;100.00
`;
const SALES = `DOCUMENTO;STONECODE;DATA DA VENDA;BANDEIRA;PRODUTO;STONE ID;N DE PARCELAS;VALOR BRUTO;VALOR LIQUIDO;DESCONTO DE MDR;DESCONTO DE ANTECIPACAO;DESCONTO UNIFICADO;N DO CARTAO;MEIO DE CAPTURA;N DE SERIE;ULTIMO STATUS;DATA DO ULTIMO STATUS;CÓDIGO DE AUTORIZAÇÃO
00000000000100;100000000;06/01/2026 21:00;MasterCard;Debito;41000000000001;1;60,000000;58,956000;-1,044000;0,000000;0,000000;000000******0000;POS;PB1;Aprovada;06/01/2026 21:00;A1
00000000000100;100000000;06/01/2026 22:00;MasterCard;Debito;41000000000002;1;40,000000;39,304000;-0,696000;0,000000;0,000000;000000******0000;POS;PB1;Aprovada;06/01/2026 22:00;A2
`;
const payout = (
  amount: string,
) => `Valor;Bandeira;Modalidade;Dígito da Conta;Número da Conta;Tipo de conta;Agência;Dígito Verificador da Agência;Identificador do Banco;Nome do Banco;Documento;StoneCode;Razão Social;Identificador Rastreável do Pagamento;Resposta do Banco;Origem da Conta;Data de Vencimento;Data de Pagamento;Status do Pagamento
${amount};Maestro;Débito;9;12345678;Conta corrente;0001;;31872495;Banco C6 S.A.;00000000000100;000000000;EMPRESA EXEMPLO LTDA;202601070000000000001;01;Cadastro;07/01/2026;07/01/2026;PaymentScheduled
`;
const C6 = `EXTRATO DE CONTA CORRENTE C6 BANK

Agência: 1 / Conta: 123456789
Extrato gerado em 08/02/2026 - as 20:32:54

Extrato de 01/01/2026 a 31/01/2026


Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)
07/01/2026,07/01/2026,CRED LOJ C DEBITO,"CART. DEBIT - Stone Pagamento, Maestro ",98.26,0.00,98.26
`;

async function bar() {
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
  const account = (key: string, type: string) =>
    finance("createAccount", { key, name: key, type });
  const [till, stoneAccount, c6] = [
    await account("caixa", "CASH"),
    await account("stone", "ACCOUNT"),
    await account("c6", "ACCOUNT"),
  ];
  const party = (key: string) =>
    finance("createParty", { key, name: key, type: "COMPANY" });
  const [customers, stone] = [await party("clientes"), await party("stone")];
  const category = (name: string, role?: string) =>
    finance("createFinancialCategory", {
      name,
      kind: "REVENUE",
      ...(role ? { role } : {}),
    });
  const sales = await category("Vendas");
  const discounts = await category("Descontos", "DEDUCTION");
  const fees = await category("Taxas", "DEDUCTION");
  const consume = (accountId: string, type: string, importerId: string) =>
    run("finance-imports.setMovementConsumer", {
      accountId,
      type,
      importerId,
    });
  await consume(till.id, "revenue-movements", "yooga/payments");
  await consume(stoneAccount.id, "revenue-movements", "stone/sales");
  await consume(c6.id, "receipt-movements", "stone/payouts");
  await consume(c6.id, "account-movements", "c6/account");
  const take = (accountId: string, type: string, content: string) =>
    run<Row & { posted: number; pending: number }>(
      "finance-imports.importMovements",
      { accountId, type, key: `drive/${type}`, content },
    );
  const revenueDescriptor = (
    accountId: string,
    descriptorKey: string,
    financialCategoryId: string,
    extra: Record<string, string> = {},
  ) =>
    finance("classifyRevenueMovementDescriptor", {
      accountId,
      descriptorKey,
      partyId: descriptorKey.endsWith("adquirente") ? stone.id : customers.id,
      financialCategoryId,
      ...extra,
    });
  // The day's sales and Stone's fee, recognized.
  await take(till.id, "revenue-movements", YOOGA);
  await revenueDescriptor(till.id, "debito_bruto", sales.id);
  await revenueDescriptor(till.id, "debito_desconto", discounts.id);
  await take(stoneAccount.id, "revenue-movements", SALES);
  await revenueDescriptor(
    stoneAccount.id,
    "debito_mastercard_taxa_adquirente",
    fees.id,
    { settlementGroup: "stone-debito-mastercard", settlesMethodKey: "debito" },
  );
  const settleDescriptors = async () => {
    for (const each of (
      await sides.descriptors<{ items: Row[] }>({
        accountId: c6.id,
        direction: "RECEIPT",
      })
    ).items)
      await sides.classify({
        accountId: c6.id,
        direction: "RECEIPT",
        descriptorKey: each.descriptorKey,
        partyId: stone.id,
        paymentMethod: "TRANSFER",
        settlementGroup: "stone-debito-mastercard",
      });
  };
  const linkOf = async (externalId: string | null) => {
    const movements = (
      await sides.list<{ items: Row[] }>({
        accountId: c6.id,
        direction: "RECEIPT",
      })
    ).items;
    const movement = movements.find((each) =>
      externalId === null
        ? each.externalId !== "202601070000000000001"
        : each.externalId === externalId,
    );
    return {
      movement,
      link: (
        await sides.links<{ items: Row[] }>({
          movementId: movement?.id,
        })
      ).items[0],
    };
  };
  const receipt = (id: unknown) =>
    finance<{ receipt: Row; settlements: Row[] }>("getReceipt", { id });
  const revenues = async () =>
    (await finance<{ items: Row[] }>("listRevenues", {})).items;
  return {
    finance,
    sides,
    take,
    settleDescriptors,
    linkOf,
    receipt,
    revenues,
    c6,
  };
}

describe("a day's card sales, from sale to cash", () => {
  test("the deposit's one receipt settles the day's gross, discount and Stone's fee, and the C6 line pays it", async () => {
    const t = await bar();
    await t.take(t.c6.id, "receipt-movements", payout("98,26"));
    await t.settleDescriptors();
    const promised = await t.linkOf("202601070000000000001");
    expect(promised.movement?.status).toBe("POSTED");
    expect(promised.link?.revenueId).toBeNull();
    const { receipt, settlements } = await t.receipt(promised.link?.receiptId);
    expect(receipt).toMatchObject({ amount: "9826", paidOn: null });
    expect(settlements.map((each) => each.amount).sort()).toEqual([
      "-1000",
      "-174",
      "11000",
    ]);
    // No revenue was created by the deposit.
    expect((await t.revenues()).length).toBe(3);

    await t.take(t.c6.id, "account-movements", C6);
    await t.settleDescriptors();
    const kept = await t.linkOf(null);
    expect(kept.link?.receiptId).toBe(promised.link?.receiptId);
    expect((await t.receipt(promised.link?.receiptId)).receipt).toMatchObject({
      amount: "9826",
      paidOn: "2026-01-07",
    });
  });

  test("a deposit its open sales do not add up to waits for a person", async () => {
    const t = await bar();
    await t.take(t.c6.id, "receipt-movements", payout("99,00"));
    await t.settleDescriptors();
    const { movement } = await t.linkOf("202601070000000000001");
    expect(movement?.status).toBe("PENDING");
    await expect(t.sides.post({ id: movement?.id })).rejects.toThrow(
      "no open sales",
    );
  });

  test("undoing the deposit, with no bank line, frees its sales for the next one", async () => {
    const t = await bar();
    await t.take(t.c6.id, "receipt-movements", payout("98,26"));
    await t.settleDescriptors();
    const { movement, link } = await t.linkOf("202601070000000000001");
    await t.sides.undo({ id: movement?.id });
    const { settlements } = await t.receipt(link?.receiptId);
    expect(settlements.every((each) => each.voidedAt)).toBe(true);
    await t.sides.post({ id: movement?.id });
    expect((await t.linkOf("202601070000000000001")).movement?.status).toBe(
      "POSTED",
    );
  });
});
