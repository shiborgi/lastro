/// <reference types="bun-types" />
/**
 * The statement-staging tools, driven through a real MCP client.
 *
 * These exist because of a bug the application-level tests could not see: the
 * resource schemas are `.strict()`, and the repository rows carry timestamps
 * (`createdAt`, `importedAt`) that describe the import rather than the money.
 * Handing a row straight to a strict schema failed every call with a generic
 * INVALID_REQUEST, and only a test that crosses the serialization boundary
 * catches that. So every case below asserts on what comes back over the wire.
 */
import { describe, expect, test } from "bun:test";
import { createApplication } from "@lastro/application";
import { fakeRepository as stub } from "@lastro/application/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./app";

const CARD_ROW = {
  id: "1",
  bookId: "1",
  institutionId: "1",
  accountId: "5",
  source: "c6/cartao/f.csv",
  key: "abc",
  occurrence: 1,
  purchaseDate: new Date("2026-08-15T00:00:00.000Z"),
  cardholder: "MARCOS WADA",
  cardNumber: "8520",
  category: "Supermercados",
  description: "PAPON MINI - MERCADO E",
  descriptorKey: "papon_mini_-_mercado_e",
  installmentNumber: null,
  installmentCount: null,
  amount: 1200n,
  currency: "BRL",
  status: "PENDING" as const,
  expenseId: null,
  // The two fields that broke it.
  importedAt: new Date("2026-09-09T00:00:00.000Z"),
  createdAt: new Date("2026-09-09T00:00:00.000Z"),
};

const ACCOUNT_ROW = {
  id: "2",
  bookId: "1",
  institutionId: "1",
  accountId: "5",
  source: "nubank/conta/f.csv",
  key: "def",
  occurrence: 1,
  branch: null,
  accountNumber: null,
  purchaseDate: new Date("2026-01-06T00:00:00.000Z"),
  title: null,
  description: "Pagamento de fatura",
  descriptorKey: "pagamento_de_fatura",
  // Negative: money leaving the account. `Amount` rejects a sign, which is why
  // these resources use `SignedAmount`.
  amount: -16450n,
  currency: "BRL",
  status: "PENDING" as const,
  expenseId: null,
  importedAt: new Date("2026-09-09T00:00:00.000Z"),
  createdAt: new Date("2026-09-09T00:00:00.000Z"),
};

function statementApplication() {
  const reviewed: Record<string, unknown>[] = [];
  const application = createApplication(
    stub({
      listInstitutions: async () => [
        { id: "1", bookId: "1", key: "c6", name: "C6 Bank" },
      ],
      /*
       * Both, so a test can declare the wrong one. The import refuses a card
       * invoice on an ACCOUNT and a statement on a CARD, which is the only check
       * the file makes possible without reading a row.
       */
      listAccounts: async () => [
        {
          id: "5",
          bookId: "1",
          key: "c6-cartao",
          institutionId: "1",
          number: "3169",
          name: "C6 Cartão",
          type: "CARD",
        },
        {
          id: "7",
          bookId: "1",
          key: "nubank-conta",
          institutionId: "2",
          number: "441776988",
          name: "Nubank Conta",
          type: "ACCOUNT",
        },
        {
          id: "6",
          bookId: "1",
          key: "c6-conta",
          institutionId: "1",
          number: "295076852",
          name: "C6 Conta",
          type: "ACCOUNT",
        },
      ],
      listCardMovements: async () => [CARD_ROW],
      listAccountMovements: async () => [ACCOUNT_ROW],
      ensureCardDescriptors: async (bookId, accountId, keys) =>
        keys.map((key, index) => ({
          id: String(index),
          bookId,
          accountId,
          key,
        })),
      ensureAccountDescriptors: async (bookId, accountId, entries) =>
        entries.map((entry, index) => ({
          id: String(index),
          bookId,
          accountId,
          key: entry.key,
          method: entry.method,
        })),
      insertCardMovements: async (rows) =>
        rows.map((row, index) => ({ ...row, id: String(index) })),
      setCardMovementStatus: async (input) => {
        reviewed.push({ ...input });
        return { ...CARD_ROW, status: input.status };
      },
      updateAccountDescriptor: async (input) => ({
        id: input.id,
        bookId: input.bookId,
        accountId: "5",
        key: "vivo_-_gvt",
        partyId: input.partyId ?? null,
        categoryId: input.categoryId ?? null,
        method: input.method ?? null,
      }),
      updateCardDescriptor: async (input) => ({
        id: input.id,
        bookId: input.bookId,
        accountId: "5",
        key: "papon_mini_-_mercado_e",
        partyId: input.partyId ?? null,
        categoryId: input.categoryId ?? null,
      }),
      listPendingCardDescriptors: async () => [
        {
          id: "9",
          bookId: "1",
          accountId: "5",
          key: "papon_mini_-_mercado_e",
          partyId: null,
          categoryId: null,
          name: null,
          movements: 21,
          total: 44290n,
          firstSeen: new Date("2026-08-06T00:00:00.000Z"),
          lastSeen: new Date("2026-08-30T00:00:00.000Z"),
          sourceCategories: [{ value: "Supermercados", count: 21 }],
        },
      ],
      listPendingAccountDescriptors: async () => [
        {
          id: "1",
          bookId: "1",
          accountId: "5",
          key: "papon_mini_-_mercado_e",
          partyId: null,
          categoryId: null,
          method: null,
          counterAccountId: null,
          name: null,
          movements: 21,
          total: 44290n,
          firstSeen: new Date("2026-08-06T00:00:00.000Z"),
          lastSeen: new Date("2026-08-30T00:00:00.000Z"),
          sourceCategories: [{ value: "Supermercados", count: 21 }],
        },
      ],
    }),
  );
  return { application, reviewed };
}

async function connect(application: ReturnType<typeof createApplication>) {
  const server = createMcpServer(
    { ping: async () => true, application },
    {
      actorId: "user-1",
      bookId: "1",
      role: "EDITOR",
      source: "MCP",
      correlationId: "test",
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "lastro-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function structured(response: unknown): Record<string, unknown> {
  return (response as { structuredContent: Record<string, unknown> })
    .structuredContent;
}

describe("statement tools over the wire", () => {
  test("a staged card row survives serialization, timestamps and all", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "list_card_movements",
      arguments: { bookId: "1" },
    });
    expect(response.isError).toBeUndefined();
    const [item] = structured(response).items as Record<string, unknown>[];
    // Money as a string, dates as ISO, and the import's own timestamps dropped.
    expect(item?.amount).toBe("1200");
    expect(item?.purchaseDate).toBe("2026-08-15T00:00:00.000Z");
    expect(item).not.toHaveProperty("importedAt");
    expect(item?.descriptorKey).toBe("papon_mini_-_mercado_e");

    await client.close();
    await server.close();
  });

  /*
   * An account row's amount is negative when money left. `Amount` is digits
   * only, so reusing it here would have rejected every outflow — which is most
   * of a real statement.
   */
  test("a negative account amount is not rejected", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "list_account_movements",
      arguments: { bookId: "1" },
    });
    expect(response.isError).toBeUndefined();
    const [item] = structured(response).items as Record<string, unknown>[];
    expect(item?.amount).toBe("-16450");

    await client.close();
    await server.close();
  });

  test("a pending account descriptor carries the evidence, with the bank's own category", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "list_pending_account_descriptors",
      arguments: { bookId: "1" },
    });
    expect(response.isError).toBeUndefined();
    const [item] = structured(response).items as Record<string, unknown>[];
    expect(item).toMatchObject({
      movements: 21,
      total: "44290",
      partyId: null,
      firstSeen: "2026-08-06T00:00:00.000Z",
    });
    expect(item?.sourceCategories).toEqual([
      { value: "Supermercados", count: 21 },
    ]);

    await client.close();
    await server.close();
  });

  /*
   * Everything downstream keys off `accountId` — the descriptors are per
   * account — so a wrong id files one account's spending under another, and
   * the foreign keys would accept it happily. Each refusal below was a real
   * accept: importing the C6 invoice under the C6 checking account went
   * through and created a second set of descriptors nobody would look at.
   */
  describe("the account the file belongs to", () => {
    const importing = (args: Record<string, unknown>) => ({
      name: "import_statement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        content: [
          "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
          "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
        ].join("\n"),
        path: "c6/cartao/f.csv",
        ...args,
      },
    });

    test("refuses an id no account in the Book has", async () => {
      const { application } = statementApplication();
      const { client, server } = await connect(application);

      const response = await client.callTool(
        importing({ accountId: "404" }) as never,
      );
      expect(response.isError).toBe(true);

      await client.close();
      await server.close();
    });

    test("refuses an account at another institution", async () => {
      const { application } = statementApplication();
      const { client, server } = await connect(application);

      // Account 7 sits at institution 2; the path names c6, institution 1.
      const response = await client.callTool(
        importing({ accountId: "7" }) as never,
      );
      expect(response.isError).toBe(true);

      await client.close();
      await server.close();
    });

    test("refuses a card invoice declared on a non-card account", async () => {
      const { application } = statementApplication();
      const { client, server } = await connect(application);

      const response = await client.callTool(
        importing({ accountId: "6" }) as never,
      );
      expect(response.isError).toBe(true);

      await client.close();
      await server.close();
    });

    test("accepts the invoice on the card account", async () => {
      const { application } = statementApplication();
      const { client, server } = await connect(application);

      const response = await client.callTool(
        importing({ accountId: "5" }) as never,
      );
      expect(response.isError).toBeUndefined();
      expect(structured(response)).toMatchObject({ kind: "card", rows: 1 });

      await client.close();
      await server.close();
    });
  });

  test("importing refuses an institution the Book does not have", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "import_statement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        accountId: "5",
        path: "nubank/conta/f.csv",
        content: "Data,Valor,Identificador,Descrição\n06/01/2026,1.00,x,Y",
      },
    });
    expect(response.isError).toBe(true);

    await client.close();
    await server.close();
  });

  /*
   * The preamble has to reach the rows. An account statement prints the period
   * and the account number above the table, so a row that does not carry them
   * cannot say which account or which month it belongs to — and the file it
   * came from is not stored. The first version parsed the header correctly and
   * then dropped it, which is invisible until someone reads a stored row.
   */
  test("an account import copies the preamble onto every row", async () => {
    const staged: Record<string, unknown>[] = [];
    const application = createApplication(
      stub({
        listInstitutions: async () => [
          { id: "1", bookId: "1", key: "c6", name: "C6 Bank" },
        ],
        /*
         * Both, so a test can declare the wrong one. The import refuses a card
         * invoice on an ACCOUNT and a statement on a CARD, which is the only check
         * the file makes possible without reading a row.
         */
        listAccounts: async () => [
          {
            id: "5",
            bookId: "1",
            key: "c6-cartao",
            institutionId: "1",
            number: "3169",
            name: "C6 Cartão",
            type: "CARD",
          },
          {
            id: "6",
            bookId: "1",
            key: "c6-conta",
            institutionId: "1",
            number: "295076852",
            name: "C6 Conta",
            type: "ACCOUNT",
          },
        ],
        ensureAccountDescriptors: async (bookId, accountId, entries) =>
          entries.map((entry, index) => ({
            id: String(index),
            bookId,
            accountId,
            key: entry.key,
            method: entry.method,
          })),
        insertAccountMovements: async (rows) => {
          staged.push(...(rows as unknown as Record<string, unknown>[]));
          return rows.map((row, index) => ({ ...row, id: String(index) }));
        },
      }),
    );
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "import_statement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        accountId: "6",
        path: "c6/conta/f.csv",
        content: [
          "EXTRATO DE CONTA CORRENTE C6 BANK",
          "",
          "Agência: 1 / Conta: 295076852",
          "",
          "Extrato de 09/08/2026 a 08/09/2026",
          "",
          "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
          "10/08/2026,10/08/2026,T,BANCO C6 S.A.,0.00,9827.29,59.42",
        ].join("\n"),
      },
    });
    expect(response.isError).toBeUndefined();
    expect(staged[0]).toMatchObject({
      branch: "1",
      accountNumber: "295076852",
      // Which account it *is* comes from the caller, not the preamble — and
      // the two agree, which the import now insists on where the file says.
      accountId: "6",
    });

    await client.close();
    await server.close();
  });

  test("importing stages rows and reports what was new", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "import_statement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        accountId: "5",
        path: "c6/cartao/f.csv",
        content: [
          "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
          "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
        ].join("\n"),
      },
    });
    expect(response.isError).toBeUndefined();
    expect(structured(response)).toMatchObject({
      institutionKey: "c6",
      kind: "card",
      rows: 1,
      inserted: 1,
      duplicates: 0,
      newDescriptors: 1,
      methodUndecided: 0,
    });

    await client.close();
    await server.close();
  });

  /*
   * POSTED means an expense exists behind the row. Accepting it here would let
   * a caller mark money recorded that was never recorded; the database refuses
   * it too, through a CHECK on (status, expense_id).
   */
  test("review refuses to post a movement", async () => {
    const { application, reviewed } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "review_movement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        kind: "card",
        id: "1",
        status: "POSTED",
      },
    });
    expect(response.isError).toBe(true);
    expect(reviewed).toHaveLength(0);

    await client.close();
    await server.close();
  });

  test("review ignores a row, and can put it back", async () => {
    const { application, reviewed } = statementApplication();
    const { client, server } = await connect(application);

    for (const status of ["IGNORED", "PENDING"]) {
      const response = await client.callTool({
        name: "review_movement",
        arguments: {
          bookId: "1",
          idempotencyKey: `k-${status}`,
          kind: "card",
          id: "1",
          status,
        },
      });
      expect(response.isError).toBeUndefined();
    }
    expect(reviewed.map((entry) => entry.status)).toEqual([
      "IGNORED",
      "PENDING",
    ]);

    await client.close();
    await server.close();
  });

  /*
   * The import's one inference, and the shape that keeps it honest. A card
   * invoice establishes CREDIT_CARD by being what it is; the text still
   * wins where it disagrees, which is how "Pag Fatura Boleto" — the payment
   * *of* the invoice — comes out as BOLETO rather than a purchase.
   */
  test("importing records how money moved, from the line wording", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const response = await client.callTool({
      name: "import_statement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        accountId: "5",
        path: "c6/cartao/f.csv",
        content: [
          "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
          "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
          "10/08/2026;MARCOS WADA;8520;-;Pag Fatura Boleto;Única;0;0;-9827.29",
        ].join("\n"),
      },
    });
    expect(response.isError).toBeUndefined();
    expect(structured(response)).toMatchObject({
      newDescriptors: 2,
      methodUndecided: 0,
    });

    await client.close();
    await server.close();
  });

  /*
   * The merged mapping in use: one descriptor carries party, category and
   * method, so a single call finishes it. The import pre-fills only `method`,
   * from the line's own wording — everything else waits for a person.
   */
  test("one call decides party, category and method for a descriptor", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    const listed = await client.callTool({
      name: "list_pending_account_descriptors",
      arguments: { bookId: "1" },
    });
    expect(listed.isError).toBeUndefined();
    const [pending] = structured(listed).items as Record<string, unknown>[];
    // Nothing decided yet, and the bank's own category shown as evidence.
    expect(pending).toMatchObject({
      partyId: null,
      categoryId: null,
      method: null,
      movements: 21,
    });

    const decided = await client.callTool({
      name: "update_account_descriptor",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        id: "1",
        partyId: "7",
        categoryId: "3",
        method: "BOLETO",
      },
    });
    expect(decided.isError).toBeUndefined();
    expect(structured(decided)).toMatchObject({
      partyId: "7",
      categoryId: "3",
      method: "BOLETO",
    });

    await client.close();
    await server.close();
  });

  test("every statement tool refuses another Book", async () => {
    const { application } = statementApplication();
    const { client, server } = await connect(application);

    for (const name of [
      "list_card_movements",
      "list_account_movements",
      "list_pending_card_descriptors",
      "list_pending_account_descriptors",
    ]) {
      const response = await client.callTool({
        name,
        arguments: { bookId: "2" },
      });
      expect(JSON.stringify(response.content)).toContain(
        "UNAUTHORIZED_OR_NOT_FOUND",
      );
    }

    await client.close();
    await server.close();
  });
});

/*
 * Promotion, and the four refusals that make it trustworthy.
 *
 * The staging step exists so that nothing becomes an economic fact by
 * accident. Every case below is a way that could happen, and the assertion is
 * that it does not: an unmapped descriptor, a category pointing the wrong way,
 * a card credit dressed as income, and a row promoted twice.
 */
describe("promoting a reviewed row", () => {
  const ACCOUNT_IN = {
    ...ACCOUNT_ROW,
    id: "9",
    amount: 634445n,
    description: "CART. DEBIT - Stone Pagamento - Maestro",
    descriptorKey: "cred_loj_c_debito_cart._debit_-_stone_pagamento_-_maestro",
  };

  function ledger(overrides: Record<string, unknown> = {}) {
    const written: Record<string, unknown>[] = [];
    const marked: Record<string, unknown>[] = [];
    const application = createApplication(
      stub({
        getAccountMovement: async () => ACCOUNT_IN,
        getCardMovement: async () => ({ ...CARD_ROW, amount: -982729n }),
        getCardDescriptorByKey: async () => ({
          id: "5",
          bookId: "1",
          accountId: "5",
          key: CARD_ROW.descriptorKey,
          partyId: "4",
          categoryId: "3",
        }),
        getAccountDescriptorByKey: async () => ({
          id: "1",
          bookId: "1",
          accountId: "5",
          key: ACCOUNT_IN.descriptorKey,
          partyId: "4",
          categoryId: "2",
          method: "DEBIT_CARD",
        }),
        listCategories: async () => [
          { id: "2", bookId: "1", kind: "REVENUE", name: "Receita de vendas" },
          { id: "3", bookId: "1", kind: "EXPENSE", name: "Insumos" },
        ],
        createRevenue: async (input) => {
          written.push({ as: "revenue", ...input });
          return {
            id: "51",
            bookId: "1",
            key: input.key,
            referenceMonth: input.referenceMonth,
            partyId: input.partyId,
            categoryId: input.categoryId,
            amount: input.amount,
            currency: input.currency,
          };
        },
        createExpense: async (input) => {
          written.push({ as: "expense", ...input });
          return {
            id: "77",
            bookId: "1",
            key: input.key,
            referenceMonth: input.referenceMonth,
            partyId: input.partyId,
            categoryId: input.categoryId,
            amount: input.amount,
            currency: input.currency,
          };
        },
        /*
         * What the card schedule needs. No window is registered here, so the
         * schedule falls back to the purchase's own month — which is the case
         * worth exercising, since it is what a Book looks like before anyone
         * fills `account_reference_month`.
         */
        listAccountReferenceMonths: async () => [],
        getRevenueByKey: async () => null,
        getReceiptByKey: async () => null,
        createReceipt: async (input) => {
          written.push({ as: "receipt", ...input });
          return {
            id: `rec-${input.key}`,
            bookId: "1",
            accountId: input.accountId,
            key: input.key,
            referenceMonth: input.referenceMonth,
            amount: input.amount,
            currency: input.currency,
            dueAt: input.dueAt,
          };
        },
        createRevenueSettlement: async (input) => {
          written.push({ as: "rev-settlement", ...input });
          return {
            id: "rs-1",
            bookId: "1",
            revenueId: input.revenueId,
            receiptId: input.receiptId,
            amount: input.amount,
            currency: input.currency,
          };
        },
        getExpenseByKey: async () => null,
        getPaymentByKey: async () => null,
        createPayment: async (input) => {
          written.push({ as: "payment", ...input });
          return {
            id: `pay-${input.key}`,
            bookId: "1",
            accountId: input.accountId,
            key: input.key,
            referenceMonth: input.referenceMonth,
            amount: 0n,
            currency: input.currency,
            dueAt: input.dueAt,
          };
        },
        createExpenseSettlement: async (input) => {
          written.push({ as: "settlement", ...input });
          return {
            id: `set-${input.installmentNumber}`,
            bookId: "1",
            expenseId: input.expenseId,
            paymentId: input.paymentId,
            amount: input.amount,
            currency: input.currency,
            installmentNumber: input.installmentNumber,
            installmentCount: input.installmentCount,
          };
        },
        setAccountMovementStatus: async (input) => {
          marked.push({ ...input });
          return { ...ACCOUNT_IN, status: input.status };
        },
        setCardMovementStatus: async (input) => {
          marked.push({ ...input });
          return { ...CARD_ROW, status: input.status };
        },
        ...overrides,
      }),
    );
    return { application, written, marked };
  }

  const post = (client: Client, extra: Record<string, unknown> = {}) =>
    client.callTool({
      name: "post_movement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        kind: "account",
        id: "9",
        referenceMonth: "2026-09-01T00:00:00.000Z",
        ...extra,
      },
    });

  /*
   * The majority case on a real statement: 107 of 162 lines are money coming
   * in. The sign alone decides it is a revenue — nothing in the call says so.
   */
  test("money in becomes a revenue, chosen by the sign", async () => {
    const { application, written, marked } = ledger();
    const { client, server } = await connect(application);

    const response = await post(client);
    expect(response.isError).toBeUndefined();
    expect(structured(response)).toMatchObject({
      kind: "revenue",
      id: "51",
      amount: "634445",
      method: "DEBIT_CARD",
    });
    expect(written[0]).toMatchObject({ as: "revenue", amount: 634445n });
    // The link is what records the decision, and it goes in the revenue slot.
    expect(marked[0]).toMatchObject({ status: "POSTED", revenueId: "51" });

    await client.close();
    await server.close();
  });

  test("money out becomes an expense", async () => {
    const { application, written } = ledger({
      getAccountMovement: async () => ({
        ...ACCOUNT_IN,
        amount: -799737n,
        descriptorKey: "karisma_imoveis_karisma_imoveis",
      }),
      getAccountDescriptorByKey: async () => ({
        id: "2",
        bookId: "1",
        key: "karisma_imoveis_karisma_imoveis",
        partyId: "7",
        categoryId: "3",
        method: null,
      }),
    });
    const { client, server } = await connect(application);

    const response = await post(client);
    expect(response.isError).toBeUndefined();
    // Sign dropped: the ledger stores what was owed, direction is the record type.
    expect(written[0]).toMatchObject({ as: "expense", amount: 799737n });
    expect(structured(response)).toMatchObject({
      kind: "expense",
      method: null,
    });

    await client.close();
    await server.close();
  });

  test("an unmapped descriptor is refused, not guessed", async () => {
    const { application, written } = ledger({
      getAccountDescriptorByKey: async () => ({
        id: "1",
        bookId: "1",
        accountId: "5",
        key: ACCOUNT_IN.descriptorKey,
        partyId: null,
        categoryId: null,
        method: "DEBIT_CARD",
      }),
    });
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBe(true);
    expect(written).toHaveLength(0);

    await client.close();
    await server.close();
  });

  /*
   * The subtle one. A supplier mapped to an expense category would otherwise
   * book incoming money as a cost, and the sign that made it revenue would be
   * the only trace left in the ledger.
   */
  test("a category pointing the wrong way is refused", async () => {
    const { application, written } = ledger({
      getAccountDescriptorByKey: async () => ({
        id: "1",
        bookId: "1",
        accountId: "5",
        key: ACCOUNT_IN.descriptorKey,
        partyId: "4",
        categoryId: "3",
        method: "DEBIT_CARD",
      }),
    });
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBe(true);
    expect(written).toHaveLength(0);

    await client.close();
    await server.close();
  });

  /*
   * "Pag Fatura Boleto" is the invoice being paid, not an earning. Promoting it
   * would inflate the month's income by the size of the bill.
   */
  /*
   * The pair that pins the rule. The descriptor is fully mapped in both, and
   * the fake serves a card row either way — so the only difference is the
   * sign, and the refusal cannot be an accident of a missing method.
   *
   * The message itself is not asserted, and cannot be: this boundary collapses
   * every unlisted error to INVALID_REQUEST on purpose. What is observable is
   * that one call writes a record and the other writes nothing.
   */
  test("a charge on a card invoice becomes an expense and its bill", async () => {
    const { application, written } = ledger({
      getCardMovement: async () => ({ ...CARD_ROW, amount: 1200n }),
    });
    const { client, server } = await connect(application);

    const response = await post(client, { kind: "card", id: "1" });
    expect(response.isError).toBeUndefined();
    /*
     * Three writes, not one. A card purchase is a debt with a schedule, and
     * the unfinanced case is that schedule with a single entry rather than a
     * separate path — so even a purchase in full produces the expense, the
     * bill it is paid by, and the settlement between them.
     */
    expect(written.map((w) => w.as)).toEqual([
      "expense",
      "payment",
      "settlement",
    ]);
    expect(written[0]).toMatchObject({ as: "expense", amount: 1200n });
    // Paid by the card, dated the month the purchase falls in.
    expect(written[1]).toMatchObject({
      as: "payment",
      method: "CREDIT_CARD",
      key: "card-5-2026-08",
    });
    expect(written[2]).toMatchObject({
      as: "settlement",
      amount: 1200n,
      installmentNumber: 1,
      installmentCount: 1,
    });
    expect(structured(response)).toMatchObject({
      kind: "expense",
      method: "CREDIT_CARD",
    });

    await client.close();
    await server.close();
  });

  /*
   * The financed case, and the two things it has to get right: the expense is
   * the whole purchase rather than the line, and there is one bill per month
   * from the purchase's own month forward.
   */
  test("a purchase in instalments becomes one expense and a bill a month", async () => {
    const { application, written } = ledger({
      getCardMovement: async () => ({
        ...CARD_ROW,
        amount: 1200n,
        installmentNumber: 3,
        installmentCount: 3,
      }),
    });
    const { client, server } = await connect(application);

    const response = await post(client, { kind: "card", id: "1" });
    expect(response.isError).toBeUndefined();

    // One expense, for three times the line.
    expect(written.filter((w) => w.as === "expense")).toHaveLength(1);
    expect(written[0]).toMatchObject({ as: "expense", amount: 3600n });
    expect(structured(response)).toMatchObject({ amount: "3600" });

    // Three bills, consecutive months, one per instalment.
    expect(written.filter((w) => w.as === "payment").map((w) => w.key)).toEqual(
      ["card-5-2026-08", "card-5-2026-09", "card-5-2026-10"],
    );

    // And the parts add back up to the expense.
    const parts = written
      .filter((w) => w.as === "settlement")
      .map((w) => w.amount as bigint);
    expect(parts).toHaveLength(3);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(3600n);

    await client.close();
    await server.close();
  });

  /*
   * The account side, one to one. There is nothing to schedule — the money
   * already left on the day the statement says it did — so the shape is one
   * expense, one bill, one settlement, and the bill is created *paid*, because
   * the statement is the evidence the money is gone.
   */
  test("an account outflow becomes an expense and a payment already paid", async () => {
    const { application, written } = ledger({
      getAccountMovement: async () => ({ ...ACCOUNT_IN, amount: -799737n }),
      getAccountDescriptorByKey: async () => ({
        id: "2",
        bookId: "1",
        accountId: "5",
        key: ACCOUNT_IN.descriptorKey,
        partyId: "7",
        // An EXPENSE category, because the movement is money out.
        categoryId: "3",
        method: "BOLETO",
      }),
    });
    const { client, server } = await connect(application);

    const response = await post(client);
    expect(response.isError).toBeUndefined();
    expect(written.map((w) => w.as)).toEqual([
      "expense",
      "payment",
      "settlement",
    ]);

    /*
     * Paid on the day the statement says the money left, and by the rail the
     * descriptor names — never CREDIT_CARD by default, the way a card bill
     * can be, because the rail is a fact about the line.
     */
    expect(written[1]).toMatchObject({
      as: "payment",
      method: "BOLETO",
      paidAt: ACCOUNT_IN.purchaseDate,
      dueAt: ACCOUNT_IN.purchaseDate,
    });
    expect(written[2]).toMatchObject({
      as: "settlement",
      installmentNumber: 1,
      installmentCount: 1,
      amount: 799737n,
    });

    await client.close();
    await server.close();
  });

  /*
   * The other direction, and its own pairing: a revenue settles against a
   * receipt, not a payment. One revenue per payer per day, because an
   * acquirer settles a day of sales in several lines and they are one
   * customer relationship's earnings, not several — but each line still gets
   * its own receipt, matching the bank statement exactly.
   */
  test("an account inflow becomes a revenue and a receipt for that line", async () => {
    const { application, written } = ledger({
      getAccountMovement: async () => ({ ...ACCOUNT_IN, amount: 634445n }),
    });
    const { client, server } = await connect(application);

    const response = await post(client);
    expect(response.isError).toBeUndefined();
    expect(written.map((w) => w.as)).toEqual([
      "revenue",
      "receipt",
      "rev-settlement",
    ]);

    /*
     * TRANSFER, though the descriptor read DEBIT_CARD off "CART. DEBIT -
     * Stone Pagamento - Maestro". That was how the *customer* paid; what
     * reaches the account is the acquirer's deposit.
     */
    expect(written[1]).toMatchObject({
      as: "receipt",
      method: "TRANSFER",
      key: `mov-account-${ACCOUNT_IN.id}-recv`,
      paidAt: ACCOUNT_IN.purchaseDate,
    });

    // The descriptor rides along, which is what tells the flags apart once
    // the deposit is one number.
    expect(written[2]).toMatchObject({
      as: "rev-settlement",
      amount: 634445n,
      description: ACCOUNT_IN.descriptorKey,
    });

    // And it writes no payment: that is the expense cycle's pair.
    expect(written.some((w) => w.as === "payment")).toBe(false);

    await client.close();
    await server.close();
  });

  test("a second flag the same day settles against the same revenue", async () => {
    const revenues: Record<string, unknown>[] = [];
    const { application, written } = ledger({
      getAccountMovement: async () => ({ ...ACCOUNT_IN, amount: 100000n }),
      // The first flag of the day already created it.
      getRevenueByKey: async () => {
        revenues.push({ found: true });
        return { id: "rev-existing", bookId: "1" } as never;
      },
    });
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBeUndefined();
    expect(revenues).toHaveLength(1);
    // No second revenue — but a receipt still lands per line, matching the
    // bank statement, and the new settlement points at the revenue reused.
    expect(written.some((w) => w.as === "revenue")).toBe(false);
    expect(written.some((w) => w.as === "receipt")).toBe(true);
    expect(written.find((w) => w.as === "rev-settlement")).toMatchObject({
      revenueId: "rev-existing",
    });

    await client.close();
    await server.close();
  });

  test("a credit on a card invoice is not income", async () => {
    const { application, written } = ledger();
    const { client, server } = await connect(application);

    expect((await post(client, { kind: "card", id: "1" })).isError).toBe(true);
    expect(written).toHaveLength(0);

    await client.close();
    await server.close();
  });

  test("a row already posted cannot be posted again", async () => {
    const { application, written } = ledger({
      getAccountMovement: async () => ({
        ...ACCOUNT_IN,
        status: "POSTED",
        revenueId: "51",
      }),
    });
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBe(true);
    expect(written).toHaveLength(0);

    await client.close();
    await server.close();
  });
});

/*
 * Transfers, and why they cannot be inferred.
 *
 * A Pix to yourself and a Pix to a supplier are the same shape on a statement:
 * money out, a name, an amount. Nothing in the file separates them, so the
 * descriptor declares TRANSFER and names the account on the other side. These
 * cases pin down what that declaration is allowed to skip and what it must not.
 */
describe("promoting a transfer", () => {
  const OUT = {
    ...ACCOUNT_ROW,
    id: "12",
    amount: -3186000n,
    accountNumber: "295076852",
    title: "Pix enviado para GELAGOELA BAR E RESTAURANTE",
    description: "TRANSF ENVIADA PIX",
    descriptorKey:
      "pix_enviado_para_gelagoela_bar_e_restaurante_transf_enviada_pix",
  };

  /*
   * The account no longer arrives as a lookup result: it is on the movement,
   * stated at import. The parameter is gone with the repository method.
   */
  function transferLedger(alias: Record<string, unknown>) {
    const written: Record<string, unknown>[] = [];
    const marked: Record<string, unknown>[] = [];
    const application = createApplication(
      stub({
        getAccountMovement: async () => OUT,
        getAccountDescriptorByKey: async () => alias as never,
        getTransferByKey: async () => null,
        createTransfer: async (input) => {
          written.push({ ...input });
          return {
            id: "31",
            bookId: "1",
            key: input.key,
            referenceMonth: input.referenceMonth,
            sourceAccountId: input.sourceAccountId,
            destinationAccountId: input.destinationAccountId,
            correlationId: "c1",
            amount: input.amount,
            currency: input.currency,
          };
        },
        setAccountMovementStatus: async (input) => {
          marked.push({ ...input });
          return { ...OUT, status: input.status };
        },
      }),
    );
    return { application, written, marked };
  }

  const MAPPED = {
    id: "5",
    bookId: "1",
    accountId: "5",
    key: OUT.descriptorKey,
    partyId: null,
    categoryId: null,
    method: "PIX",
    // Naming another account is what declares this a transfer.
    counterAccountId: "9",
  };

  const post = (client: Client) =>
    client.callTool({
      name: "post_movement",
      arguments: {
        bookId: "1",
        idempotencyKey: "k",
        kind: "account",
        id: "12",
        referenceMonth: "2026-09-01T00:00:00.000Z",
      },
    });

  /*
   * The account the money left is on the movement, stated at import, so the
   * operator only ever names the far side. It used to be looked up from the
   * institution plus the number in the preamble, which failed on a file that
   * prints no number at all.
   */
  test("money out flows from the file's own account to the named one", async () => {
    const { application, written, marked } = transferLedger(MAPPED);
    const { client, server } = await connect(application);

    const response = await post(client);
    expect(response.isError).toBeUndefined();
    expect(structured(response)).toMatchObject({ kind: "transfer", id: "31" });
    expect(written[0]).toMatchObject({
      // The movement's own account, not a lookup result.
      sourceAccountId: "5",
      destinationAccountId: "9",
      amount: 3186000n,
    });
    // The link records what the line became, in its own slot.
    expect(marked[0]).toMatchObject({ status: "POSTED", transferId: "31" });

    await client.close();
    await server.close();
  });

  /* A transfer has no counterparty and nothing to classify. Demanding either
   * would make every transfer unpromotable. */
  test("neither a party nor a category is required", async () => {
    const { application, written } = transferLedger(MAPPED);
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBeUndefined();
    expect(written).toHaveLength(1);

    await client.close();
    await server.close();
  });

  /*
   * Without another account it is not a transfer at all: it becomes an expense
   * and is refused for the party it has not got. The old wording ("a transfer
   * but names no other account") described a state that can no longer exist,
   * because naming the account *is* the declaration.
   */
  test("with no other account it is not a transfer, and needs a party", async () => {
    const { application, written } = transferLedger({
      ...MAPPED,
      counterAccountId: null,
    });
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBe(true);
    expect(written).toHaveLength(0);

    await client.close();
    await server.close();
  });

  /*
   * The two statements that record one transfer have to produce one ledger
   * record. Keyed on the movement, each side wrote its own and the ledger said
   * twice as much money moved as did — so the second sighting has to find the
   * first one's transfer.
   */
  test("the other side of the same transfer finds the first one", async () => {
    const written: Record<string, unknown>[] = [];
    const application = createApplication(
      stub({
        getAccountMovement: async () => ({ ...OUT, amount: 3186000n }),
        getAccountDescriptorByKey: async () => MAPPED as never,
        // The outflow already created it, under the event's key.
        getTransferByKey: async () => ({ id: "31", bookId: "1" }) as never,
        // Annotated because the outer literal is cast, so nothing contextually
        // types the parameter — and an implicit any is a lint failure here.
        createTransfer: async (input: { key: string }) => {
          written.push({ ...input });
          return { id: "99", bookId: "1", key: input.key } as never;
        },
        setAccountMovementStatus: async () => OUT as never,
        listCategories: async () => [],
      } as never),
    );
    const { client, server } = await connect(application);

    const response = await post(client);
    expect(response.isError).toBeUndefined();
    // No second transfer, and the line points at the one that existed.
    expect(written).toHaveLength(0);
    expect(structured(response)).toMatchObject({ kind: "transfer", id: "31" });

    await client.close();
    await server.close();
  });

  /*
   * And the key is the event, so it cannot be the movement's. Both sides
   * normalise the direction before hashing — payer first either way — which
   * is what makes one key out of two sightings.
   */
  test("the transfer's key is derived from the event, not the row", async () => {
    const { application, written } = transferLedger(MAPPED);
    const { client, server } = await connect(application);

    expect((await post(client)).isError).toBeUndefined();
    expect(String(written[0]?.key)).toMatch(/^xfer-[0-9a-f]{32}$/);
    expect(String(written[0]?.key)).not.toContain(OUT.id);

    await client.close();
    await server.close();
  });

  /*
   * There is no "unresolvable account" case any more. It used to exist because
   * the account was looked up from the institution plus the number printed on
   * the statement, and a file that prints no number — the Nubank export prints
   * none — could not be promoted at all. The account is now on the movement,
   * NOT NULL, stated at import: the failure mode is gone by construction
   * rather than handled.
   */

  /*
   * The other direction of the same declaration: the sign still decides which
   * way the money went, so an inflow reverses source and destination.
   */
  test("money in reverses the direction", async () => {
    const { application, written } = transferLedger(MAPPED);
    const inbound = createApplication(
      stub({
        getAccountMovement: async () => ({ ...OUT, amount: 1280500n }),
        getAccountDescriptorByKey: async () => MAPPED as never,
        getTransferByKey: async () => null,
        createTransfer: async (input) => {
          written.push({ ...input });
          return {
            id: "32",
            bookId: "1",
            key: input.key,
            referenceMonth: input.referenceMonth,
            sourceAccountId: input.sourceAccountId,
            destinationAccountId: input.destinationAccountId,
            correlationId: "c2",
            amount: input.amount,
            currency: input.currency,
          };
        },
        setAccountMovementStatus: async () => ({ ...OUT, status: "POSTED" }),
      }),
    );
    void application;
    const { client, server } = await connect(inbound);

    expect((await post(client)).isError).toBeUndefined();
    expect(written.at(-1)).toMatchObject({
      sourceAccountId: "9",
      destinationAccountId: "5",
    });

    await client.close();
    await server.close();
  });

  /* A descriptor claiming EXPENSE on an inflow is contradicted by the file. */
  test("a declaration the sign contradicts is refused", async () => {
    const { application, written } = transferLedger(MAPPED);
    void application;
    const contradicted = createApplication(
      stub({
        getAccountMovement: async () => ({ ...OUT, amount: 500n }),
        getAccountDescriptorByKey: async () =>
          ({
            ...MAPPED,
            kind: "EXPENSE",
            partyId: "7",
            categoryId: "3",
          }) as never,
        listCategories: async () => [
          { id: "3", bookId: "1", kind: "EXPENSE" as const, name: "Insumos" },
        ],
        createExpense: async (input) => {
          written.push({ ...input });
          return {
            id: "99",
            bookId: "1",
            key: input.key,
            referenceMonth: input.referenceMonth,
            partyId: input.partyId,
            categoryId: input.categoryId,
            amount: input.amount,
            currency: input.currency,
          };
        },
      }),
    );
    const { client, server } = await connect(contradicted);

    expect((await post(client)).isError).toBe(true);

    await client.close();
    await server.close();
  });
});
