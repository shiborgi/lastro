/// <reference types="bun-types" />
/**
 * How each way of paying becomes cash over memory (ADR 20): Pix lands in the
 * Stone account net of Stone's fee, cash is in the till on the day, and a
 * voucher operator deposits what it pays, keeping its fee.
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
2026-01-06;Pix;1;50.00;0.00;0.00;50.00
2026-01-06;Dinheiro;1;30.00;0.00;0.00;30.00
2026-01-06;Vale Refeição;1;80.00;0.00;0.00;80.00
2026-01-06;TOTAL;3;160.00;0.00;0.00;160.00
`;
const SALES = `DOCUMENTO;STONECODE;DATA DA VENDA;BANDEIRA;PRODUTO;STONE ID;N DE PARCELAS;VALOR BRUTO;VALOR LIQUIDO;DESCONTO DE MDR;DESCONTO DE ANTECIPACAO;DESCONTO UNIFICADO;N DO CARTAO;MEIO DE CAPTURA;N DE SERIE;ULTIMO STATUS;DATA DO ULTIMO STATUS;CÓDIGO DE AUTORIZAÇÃO
00000000000100;100000000;06/01/2026 21:00;;Pix QRcode;E1;;50,000000;49,630000;-0,370000;0,000000;0,000000;;POS;PB1;Aprovada;06/01/2026 21:00;
`;
const STONE_ACCOUNT = `Movimentação,Tipo,Valor,Saldo antes,Saldo depois,Tarifa,Data,Horário,Situação,Nosso Número,Destino,Destino Documento,Destino Instituição,Destino Agência,Destino Conta,Origem,Origem Documento,Origem Instituição,Origem Agência,Origem Conta,Descrição
Crédito,Transação,"50,00","R$ 0,00","R$ 49,63","R$ 0,37",06/01/2026 21:00,21:00:00.000,FINISHED,,EMPRESA EXEMPLO LTDA,,Stone Instituição de Pagamento S.A.,0001,1234567-8,CLIENTE EXEMPLO,,NU PAGAMENTOS S.A.,Desconhecido,Desconhecido,
`;
const C6 = `EXTRATO DE CONTA CORRENTE C6 BANK

Agência: 1 / Conta: 123456789
Extrato gerado em 08/02/2026 - as 20:32:54

Extrato de 01/01/2026 a 31/01/2026


Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)
20/01/2026,20/01/2026,RECEBIMENTO DE TED,00000000000000-PLUXEE BENEFICIOS BRASIL ,75.00,0.00,75.00
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
  const till = await account("caixa", "CASH");
  const stoneAccount = await account("stone", "ACCOUNT");
  const c6 = await account("c6", "ACCOUNT");
  const party = (key: string) =>
    finance("createParty", { key, name: key, type: "COMPANY" });
  const customers = await party("clientes");
  const stone = await party("stone");
  const pluxee = await party("pluxee");
  const sales = await finance("createFinancialCategory", {
    name: "Vendas",
    kind: "REVENUE",
  });
  const fees = await finance("createFinancialCategory", {
    name: "Taxas",
    kind: "REVENUE",
    role: "DEDUCTION",
  });
  const take = async (
    accountId: string,
    type: string,
    importerId: string,
    content: string,
  ) => {
    await run("finance-imports.setMovementConsumer", {
      accountId,
      type,
      importerId,
    });
    return run("finance-imports.importMovements", {
      accountId,
      type,
      key: `drive/${importerId}`,
      content,
    });
  };
  const revenueDescriptor = (
    accountId: string,
    descriptorKey: string,
    extra: Record<string, string> = {},
  ) =>
    finance("classifyRevenueMovementDescriptor", {
      accountId,
      descriptorKey,
      partyId: descriptorKey.endsWith("adquirente") ? stone.id : customers.id,
      financialCategoryId: descriptorKey.endsWith("adquirente")
        ? fees.id
        : sales.id,
      ...extra,
    });
  const receiptDescriptor = async (
    accountId: string,
    partyId: string,
    paymentMethod: string,
    settlementGroup: string,
  ) => {
    for (const each of (
      await sides.descriptors<{ items: Row[] }>({
        accountId,
        direction: "RECEIPT",
      })
    ).items)
      await sides.classify({
        accountId,
        direction: "RECEIPT",
        descriptorKey: each.descriptorKey,
        partyId,
        paymentMethod,
        settlementGroup,
      });
  };
  const receiptOf = async (accountId: string) => {
    const [movement] = (
      await sides.list<{ items: Row[] }>({
        accountId,
        direction: "RECEIPT",
      })
    ).items;
    const [link] = (
      await sides.links<{ items: Row[] }>({
        movementId: movement?.id,
      })
    ).items;
    return finance<{ receipt: Row; settlements: Row[] }>("getReceipt", {
      id: link?.receiptId,
    });
  };
  await take(till.id, "revenue-movements", "yooga/payments", YOOGA);
  return {
    finance,
    sides,
    take,
    revenueDescriptor,
    receiptDescriptor,
    receiptOf,
    till,
    stoneAccount,
    c6,
    stone,
    pluxee,
  };
}

describe("each way of paying, from sale to cash", () => {
  test("Pix: the day's sales in the Stone account settle Yooga's Pix and Stone's fee", async () => {
    const t = await bar();
    await t.revenueDescriptor(t.till.id, "pix_bruto");
    await t.take(t.stoneAccount.id, "revenue-movements", "stone/sales", SALES);
    await t.revenueDescriptor(t.stoneAccount.id, "pix_qrcode_taxa_adquirente", {
      settlementGroup: "stone-pix",
      settlesMethodKey: "pix",
    });
    await t.take(
      t.stoneAccount.id,
      "account-movements",
      "stone/account",
      STONE_ACCOUNT,
    );
    await t.receiptDescriptor(
      t.stoneAccount.id,
      t.stone.id,
      "PIX",
      "stone-pix",
    );
    const { receipt, settlements } = await t.receiptOf(t.stoneAccount.id);
    expect(receipt).toMatchObject({ amount: "4963", paidOn: "2026-01-06" });
    expect(settlements.map((each) => each.amount).sort()).toEqual([
      "-37",
      "5000",
    ]);
  });

  test("cash: the record's own receipt is in the till on the day", async () => {
    const t = await bar();
    const { posted } = await t.revenueDescriptor(t.till.id, "dinheiro_bruto", {
      receivedAccountId: t.till.id,
    });
    expect(posted).toBe(1);
    const receipts = (
      await t.finance<{ items: Row[] }>("listReceipts", {
        accountId: t.till.id,
      })
    ).items;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      amount: "3000",
      paidOn: "2026-01-06",
    });
  });

  test("voucher: the operator's deposit fills the open sales in turn; what it keeps stays open", async () => {
    const t = await bar();
    await t.revenueDescriptor(t.till.id, "vale_refeicao_bruto", {
      settlementGroup: "vale",
    });
    await t.take(t.c6.id, "account-movements", "c6/account", C6);
    await t.receiptDescriptor(t.c6.id, t.pluxee.id, "TRANSFER", "vale");
    const { receipt, settlements } = await t.receiptOf(t.c6.id);
    expect(receipt).toMatchObject({ amount: "7500", paidOn: "2026-01-20" });
    expect(settlements.map((each) => each.amount)).toEqual(["7500"]);
    const revenue = await t.finance("getRevenue", {
      id: settlements[0]?.revenueId,
    });
    expect(revenue).toMatchObject({
      settled: "7500",
      outstanding: "500",
      status: "PARTIALLY_SETTLED",
    });
  });
});
