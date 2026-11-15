import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
/// <reference types="bun-types" />
/*
 * The stone-payouts flow on the real database (docs/flows/stone-payouts.md,
 * ADR 20): Stone's deposits are promises, receipt movements of C6 posted as
 * expected receipts, and the C6 statement's line for the same money pays the
 * same receipt, met by statement key.
 */
import { accountMovementSides } from "@lastro/finance/testing";
import { createHost } from "@lastro/host";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

const fixture = (flow: string, name: string) =>
  readFileSync(
    resolve(
      import.meta.dir,
      `../../../../modules/finance-imports/src/parsers/${flow}/fixtures`,
      name,
    ),
    "utf8",
  );

type Row = { id: string } & Record<string, unknown>;

const ALL_YOOGA = `data;forma_pagamento;quantidade;bruto;desconto;acrescimo;valor
2026-01-06;Pix;1;50.00;0.00;0.00;50.00
2026-01-06;Dinheiro;1;30.00;0.00;0.00;30.00
2026-01-06;Vale Refeição;1;80.00;0.00;0.00;80.00
2026-01-06;TOTAL;3;160.00;0.00;0.00;160.00
`;
const PIX_SALES = `DOCUMENTO;STONECODE;DATA DA VENDA;BANDEIRA;PRODUTO;STONE ID;N DE PARCELAS;VALOR BRUTO;VALOR LIQUIDO;DESCONTO DE MDR;DESCONTO DE ANTECIPACAO;DESCONTO UNIFICADO;N DO CARTAO;MEIO DE CAPTURA;N DE SERIE;ULTIMO STATUS;DATA DO ULTIMO STATUS;CÓDIGO DE AUTORIZAÇÃO
00000000000100;100000000;06/01/2026 21:00;;Pix QRcode;E1;;50,000000;49,630000;-0,370000;0,000000;0,000000;;POS;PB1;Aprovada;06/01/2026 21:00;
`;
const STONE_ACCOUNT = `Movimentação,Tipo,Valor,Saldo antes,Saldo depois,Tarifa,Data,Horário,Situação,Nosso Número,Destino,Destino Documento,Destino Instituição,Destino Agência,Destino Conta,Origem,Origem Documento,Origem Instituição,Origem Agência,Origem Conta,Descrição
Crédito,Transação,"50,00","R$ 0,00","R$ 49,63","R$ 0,37",06/01/2026 21:00,21:00:00.000,FINISHED,,EMPRESA EXEMPLO LTDA,,Stone Instituição de Pagamento S.A.,0001,1234567-8,CLIENTE EXEMPLO,,NU PAGAMENTOS S.A.,Desconhecido,Desconhecido,
`;
const VOUCHER_C6 = `EXTRATO DE CONTA CORRENTE C6 BANK

Agência: 1 / Conta: 123456789
Extrato gerado em 08/02/2026 - as 20:32:54

Extrato de 01/01/2026 a 31/01/2026


Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)
20/01/2026,20/01/2026,RECEBIMENTO DE TED,00000000000000-PLUXEE BENEFICIOS BRASIL ,75.00,0.00,75.00
`;

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

describe("Stone payouts on PostgreSQL", () => {
  test("the promise is expected until its C6 line pays the same receipt; undoing the line makes it expected again", async () => {
    const seeded = await seedBook(db, ["EDITOR"]);
    const run = async <T = Row>(id: string, input: unknown) =>
      (await host.execute(id, seeded.as("EDITOR"), input)) as T;
    const sides = accountMovementSides(run);
    const c6 = await run("finance.createAccount", {
      key: "c6",
      name: "C6",
      type: "ACCOUNT",
    });
    const stone = await run("finance.createParty", {
      key: "stone",
      name: "Stone",
      type: "COMPANY",
    });
    const cards = await run("finance.createFinancialCategory", {
      name: "Vendas em cartão",
      kind: "REVENUE",
    });
    for (const [type, importerId, flow] of [
      ["receipt-movements", "stone/payouts", "stone-payouts"],
      ["account-movements", "c6/account", "c6-account"],
    ] as const) {
      await run("finance-imports.setMovementConsumer", {
        accountId: c6.id,
        type,
        importerId,
      });
      await run("finance-imports.importMovements", {
        accountId: c6.id,
        type,
        key: `drive/${flow}/month.csv`,
        content: fixture(flow, "month.csv"),
      });
    }
    const descriptors = (
      await sides.descriptors<{ items: Row[] }>({
        accountId: c6.id,
        direction: "RECEIPT",
      })
    ).items;
    for (const each of descriptors)
      await sides.classify({
        accountId: c6.id,
        direction: "RECEIPT",
        descriptorKey: each.descriptorKey,
        partyId: stone.id,
        financialCategoryId: cards.id,
        paymentMethod: "TRANSFER",
      });
    const movements = (
      await sides.list<{ items: Row[] }>({
        accountId: c6.id,
        direction: "RECEIPT",
      })
    ).items;
    const deposit = movements.find(
      (each) => each.externalId === "202601070000000000001",
    );
    const [link] = (
      await sides.links<{ items: Row[] }>({
        statementKey: (
          await sides.links<{ items: Row[] }>({
            movementId: deposit?.id,
          })
        ).items[0]?.statementKey,
      })
    ).items;
    const sightings = (
      await sides.links<{ items: Row[] }>({
        statementKey: link?.statementKey,
      })
    ).items;
    expect(sightings).toHaveLength(2);
    expect(new Set(sightings.map((each) => each.receiptId)).size).toBe(1);

    const receipt = async () =>
      (
        await run<{ receipt: Row }>("finance.getReceipt", {
          id: link?.receiptId,
        })
      ).receipt;
    expect(await receipt()).toMatchObject({
      amount: "93703",
      paidOn: "2026-01-07",
    });

    const line = movements.find(
      (each) =>
        each.amount === "93703" && each.externalId !== deposit?.externalId,
    );
    await sides.undo({ id: line?.id });
    expect(await receipt()).toMatchObject({ amount: "93703", paidOn: null });
  });

  test("a deposit's one receipt settles the day's Yooga revenues and Stone's fee, and the C6 line pays it", async () => {
    const seeded = await seedBook(db, ["EDITOR"]);
    const run = async <T = Row>(id: string, input: unknown) =>
      (await host.execute(id, seeded.as("EDITOR"), input)) as T;
    const sides = accountMovementSides(run);
    const account = (key: string, type: string) =>
      run("finance.createAccount", { key, name: key, type });
    const till = await account("caixa", "CASH");
    const stoneAccount = await account("stone", "ACCOUNT");
    const c6 = await account("c6", "ACCOUNT");
    const party = (key: string) =>
      run("finance.createParty", { key, name: key, type: "COMPANY" });
    const customers = await party("clientes");
    const stone = await party("stone");
    const category = (name: string, role?: string) =>
      run("finance.createFinancialCategory", {
        name,
        kind: "REVENUE",
        ...(role ? { role } : {}),
      });
    const sales = await category("Vendas");
    const discounts = await category("Descontos", "DEDUCTION");
    const fees = await category("Taxas", "DEDUCTION");
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
    const classify = (
      accountId: string,
      descriptorKey: string,
      partyId: string,
      financialCategoryId: string,
      extra: Record<string, string> = {},
    ) =>
      run("finance.classifyRevenueMovementDescriptor", {
        accountId,
        descriptorKey,
        partyId,
        financialCategoryId,
        ...extra,
      });
    await take(till.id, "revenue-movements", "yooga/payments", YOOGA);
    await classify(till.id, "debito_bruto", customers.id, sales.id);
    await classify(till.id, "debito_desconto", customers.id, discounts.id);
    await take(stoneAccount.id, "revenue-movements", "stone/sales", SALES);
    await classify(
      stoneAccount.id,
      "debito_mastercard_taxa_adquirente",
      stone.id,
      fees.id,
      {
        settlementGroup: "stone-debito-mastercard",
        settlesMethodKey: "debito",
      },
    );
    await take(c6.id, "receipt-movements", "stone/payouts", payout("98,26"));
    await take(c6.id, "account-movements", "c6/account", C6);
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
    const links = (
      await sides.links<{ items: Row[] }>({
        statementKey: `p${stone.id}-TRANSFER-a${c6.id}-20260107-9826`,
      })
    ).items;
    expect(links).toHaveLength(2);
    expect(new Set(links.map((each) => each.receiptId)).size).toBe(1);
    const { receipt, settlements } = await run<{
      receipt: Row;
      settlements: Row[];
    }>("finance.getReceipt", { id: links[0]?.receiptId });
    expect(receipt).toMatchObject({ amount: "9826", paidOn: "2026-01-07" });
    expect(settlements.map((each) => each.amount).sort()).toEqual([
      "-1000",
      "-174",
      "11000",
    ]);
  });

  test("Pix in the Stone account, cash in the till and a voucher deposit each settle their sales", async () => {
    const seeded = await seedBook(db, ["EDITOR"]);
    const run = async <T = Row>(id: string, input: unknown) =>
      (await host.execute(id, seeded.as("EDITOR"), input)) as T;
    const sides = accountMovementSides(run);
    const account = (key: string, type: string) =>
      run("finance.createAccount", { key, name: key, type });
    const till = await account("caixa", "CASH");
    const stoneAccount = await account("stone", "ACCOUNT");
    const c6 = await account("c6", "ACCOUNT");
    const party = (key: string) =>
      run("finance.createParty", { key, name: key, type: "COMPANY" });
    const customers = await party("clientes");
    const stone = await party("stone");
    const pluxee = await party("pluxee");
    const sales = await run("finance.createFinancialCategory", {
      name: "Vendas",
      kind: "REVENUE",
    });
    const fees = await run("finance.createFinancialCategory", {
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
      await run("finance-imports.importMovements", {
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
      run("finance.classifyRevenueMovementDescriptor", {
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
    const receiptsIn = async (accountId: string) =>
      (await run<{ items: Row[] }>("finance.listReceipts", { accountId }))
        .items;

    await take(till.id, "revenue-movements", "yooga/payments", ALL_YOOGA);
    await revenueDescriptor(till.id, "pix_bruto");
    await revenueDescriptor(till.id, "dinheiro_bruto", {
      receivedAccountId: till.id,
    });
    await revenueDescriptor(till.id, "vale_refeicao_bruto", {
      settlementGroup: "vale",
    });
    await take(stoneAccount.id, "revenue-movements", "stone/sales", PIX_SALES);
    await revenueDescriptor(stoneAccount.id, "pix_qrcode_taxa_adquirente", {
      settlementGroup: "stone-pix",
      settlesMethodKey: "pix",
    });
    await take(
      stoneAccount.id,
      "account-movements",
      "stone/account",
      STONE_ACCOUNT,
    );
    await receiptDescriptor(stoneAccount.id, stone.id, "PIX", "stone-pix");
    await take(c6.id, "account-movements", "c6/account", VOUCHER_C6);
    await receiptDescriptor(c6.id, pluxee.id, "TRANSFER", "vale");

    expect(await receiptsIn(till.id)).toMatchObject([
      { amount: "3000", paidOn: "2026-01-06" },
    ]);
    expect(await receiptsIn(stoneAccount.id)).toMatchObject([
      { amount: "4963", paidOn: "2026-01-06" },
    ]);
    expect(await receiptsIn(c6.id)).toMatchObject([
      { amount: "7500", paidOn: "2026-01-20" },
    ]);
  });
});
