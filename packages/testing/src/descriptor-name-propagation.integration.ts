/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  accountMovements,
  cardMovements,
  closeDb,
  createDb,
  createRepositories,
  expenses,
  revenues,
} from "@lastro/db";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

function audit(bookId: string, resourceType: string, action: string) {
  return {
    actorType: "USER" as const,
    actorPrincipal: "descriptor-name-user",
    delegatedOperator: "descriptor-name-user",
    bookId,
    source: "API" as const,
    correlationId: randomUUID(),
    action,
    resourceType,
    payload: {},
  };
}

/*
 * The report this closes: renaming a descriptor changed the descriptor and
 * every *future* promotion, but an expense or revenue already created from it
 * kept whatever name it was given at the time — there is no later edit path
 * for either, so nothing short of a bulk SQL fix could correct a title
 * chosen before the operator settled on a better one. `updateCardDescriptor`
 * / `updateAccountDescriptor` now carry that correction to every record the
 * descriptor has already promoted, in the same transaction as the rename.
 */
describe("renaming a descriptor propagates to what it already promoted", () => {
  test("the card side: every expense billed from this descriptor", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);

    try {
      const book = await repositories.createBook("Descriptor Rename — Card");
      const institution = await repositories.createInstitution(
        { bookId: book.id, key: "c6", name: "C6 Bank" },
        audit(book.id, "institution", "institution.created"),
      );
      const account = await repositories.createAccount(
        { bookId: book.id, key: "c6-cartao", name: "C6 Cartão", type: "CARD" },
        audit(book.id, "account", "account.created"),
      );
      const party = await repositories.createParty(
        { bookId: book.id, key: "papon", name: "Papon Mini", type: "COMPANY" },
        audit(book.id, "party", "party.created"),
      );
      const category = await repositories.createCategory(
        { bookId: book.id, kind: "EXPENSE", name: "Insumos" },
        audit(book.id, "category", "category.created"),
      );

      const descriptor = await repositories.createCardDescriptor(
        {
          bookId: book.id,
          accountId: account.id,
          key: "papon_mini",
          partyId: party.id,
          categoryId: category.id,
          name: "Papon Mini",
        },
        audit(book.id, "card_descriptor", "card_descriptor.created"),
      );

      // Two purchases already promoted under the old name, exactly as
      // `postMovement` would have left them — a card movement whose status
      // is POSTED and whose expenseId is the only one of the three set.
      const [firstExpense] = await db
        .insert(expenses)
        .values({
          bookId: Number(book.id),
          key: "card-first",
          referenceMonth: new Date("2026-08-01T00:00:00Z"),
          partyId: Number(party.id),
          categoryId: Number(category.id),
          name: descriptor.name,
          amount: 4835n,
          currency: "BRL",
        })
        .returning();
      const [secondExpense] = await db
        .insert(expenses)
        .values({
          bookId: Number(book.id),
          key: "card-second",
          referenceMonth: new Date("2026-08-01T00:00:00Z"),
          partyId: Number(party.id),
          categoryId: Number(category.id),
          name: descriptor.name,
          amount: 2200n,
          currency: "BRL",
        })
        .returning();
      for (const [key, occurrence, expenseId] of [
        ["card-first", 1, firstExpense.id],
        ["card-second", 1, secondExpense.id],
      ] as const) {
        await db.insert(cardMovements).values({
          bookId: Number(book.id),
          institutionId: Number(institution.id),
          accountId: Number(account.id),
          source: "c6/cartao/fixture.csv",
          key,
          occurrence,
          purchaseDate: new Date("2026-08-06T00:00:00Z"),
          description: "PAPON MINI - MERCADO E",
          descriptorKey: descriptor.key,
          amount: 4835n,
          status: "POSTED",
          expenseId,
        });
      }

      await repositories.updateCardDescriptor(
        { bookId: book.id, id: descriptor.id, name: "Papon Mini Mercado" },
        audit(book.id, "card_descriptor", "card_descriptor.updated"),
      );

      const after1 = await repositories.getExpense(
        book.id,
        String(firstExpense.id),
      );
      const after2 = await repositories.getExpense(
        book.id,
        String(secondExpense.id),
      );
      expect(after1?.name).toBe("Papon Mini Mercado");
      expect(after2?.name).toBe("Papon Mini Mercado");
    } finally {
      await closeDb(db);
    }
  });

  test("the account side: an expense and a revenue from the same descriptor, never crossed", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);

    try {
      const book = await repositories.createBook("Descriptor Rename — Account");
      const institution = await repositories.createInstitution(
        { bookId: book.id, key: "c6", name: "C6 Bank" },
        audit(book.id, "institution", "institution.created"),
      );
      const account = await repositories.createAccount(
        { bookId: book.id, key: "c6-conta", name: "C6 Conta", type: "ACCOUNT" },
        audit(book.id, "account", "account.created"),
      );
      const party = await repositories.createParty(
        { bookId: book.id, key: "stone", name: "Stone", type: "COMPANY" },
        audit(book.id, "party", "party.created"),
      );
      const expenseCategory = await repositories.createCategory(
        { bookId: book.id, kind: "EXPENSE", name: "Taxas" },
        audit(book.id, "category", "category.created"),
      );
      const revenueCategory = await repositories.createCategory(
        { bookId: book.id, kind: "REVENUE", name: "Vendas cartão" },
        audit(book.id, "category", "category.created"),
      );

      // Same wording, same account: one descriptor, and the two things it
      // has promoted so far happen to be an expense and a revenue.
      const descriptor = await repositories.createAccountDescriptor(
        {
          bookId: book.id,
          accountId: account.id,
          key: "stone_maestro",
          partyId: party.id,
          categoryId: expenseCategory.id,
          method: "TRANSFER",
          name: "Stone",
        },
        audit(book.id, "account_descriptor", "account_descriptor.created"),
      );

      const [expense] = await db
        .insert(expenses)
        .values({
          bookId: Number(book.id),
          key: "acct-expense",
          referenceMonth: new Date("2026-08-01T00:00:00Z"),
          partyId: Number(party.id),
          categoryId: Number(expenseCategory.id),
          name: descriptor.name,
          amount: 1000n,
          currency: "BRL",
        })
        .returning();
      const [revenue] = await db
        .insert(revenues)
        .values({
          bookId: Number(book.id),
          key: "acct-revenue",
          referenceMonth: new Date("2026-08-01T00:00:00Z"),
          partyId: Number(party.id),
          categoryId: Number(revenueCategory.id),
          name: descriptor.name,
          amount: 11500n,
          currency: "BRL",
        })
        .returning();
      await db.insert(accountMovements).values({
        bookId: Number(book.id),
        institutionId: Number(institution.id),
        accountId: Number(account.id),
        source: "c6/conta/fixture.csv",
        key: "acct-expense",
        occurrence: 1,
        purchaseDate: new Date("2026-08-06T00:00:00Z"),
        description: "STONE TAXA",
        descriptorKey: descriptor.key,
        amount: -1000n,
        status: "POSTED",
        expenseId: expense.id,
      });
      await db.insert(accountMovements).values({
        bookId: Number(book.id),
        institutionId: Number(institution.id),
        accountId: Number(account.id),
        source: "c6/conta/fixture.csv",
        key: "acct-revenue",
        occurrence: 1,
        purchaseDate: new Date("2026-08-06T00:00:00Z"),
        description: "STONE DEPOSITO",
        descriptorKey: descriptor.key,
        amount: 11500n,
        status: "POSTED",
        revenueId: revenue.id,
      });

      await repositories.updateAccountDescriptor(
        { bookId: book.id, id: descriptor.id, name: "Stone Pagamentos" },
        audit(book.id, "account_descriptor", "account_descriptor.updated"),
      );

      const afterExpense = await repositories.getExpense(
        book.id,
        String(expense.id),
      );
      const afterRevenue = await repositories.getRevenue(
        book.id,
        String(revenue.id),
      );
      expect(afterExpense?.name).toBe("Stone Pagamentos");
      expect(afterRevenue?.name).toBe("Stone Pagamentos");
    } finally {
      await closeDb(db);
    }
  });

  test("the transfer side: the descriptor is the transfer's own declaration", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);

    try {
      const book = await repositories.createBook(
        "Descriptor Rename — Transfer",
      );
      const institution = await repositories.createInstitution(
        { bookId: book.id, key: "c6", name: "C6 Bank" },
        audit(book.id, "institution", "institution.created"),
      );
      const source = await repositories.createAccount(
        { bookId: book.id, key: "c6-conta", name: "C6 Conta", type: "ACCOUNT" },
        audit(book.id, "account", "account.created"),
      );
      const destination = await repositories.createAccount(
        {
          bookId: book.id,
          key: "nubank-conta",
          name: "Nubank Conta",
          type: "ACCOUNT",
        },
        audit(book.id, "account", "account.created"),
      );

      // A named account is the declaration that this descriptor is a
      // transfer — it needs neither party nor category, only the account on
      // the other side.
      const descriptor = await repositories.createAccountDescriptor(
        {
          bookId: book.id,
          accountId: source.id,
          key: "pix_enviado_para_gelagoela",
          counterAccountId: destination.id,
          name: "Gelagoela Bar",
        },
        audit(book.id, "account_descriptor", "account_descriptor.created"),
      );

      const transfer = await repositories.createTransfer(
        {
          bookId: book.id,
          key: "xfer-fixture",
          referenceMonth: new Date("2026-08-01T00:00:00Z"),
          sourceAccountId: source.id,
          destinationAccountId: destination.id,
          name: descriptor.name,
          amount: 190550n,
          currency: "BRL",
        },
        audit(book.id, "transfer", "transfer.created"),
      );
      await db.insert(accountMovements).values({
        bookId: Number(book.id),
        institutionId: Number(institution.id),
        accountId: Number(source.id),
        source: "c6/conta/fixture.csv",
        key: "xfer-out",
        occurrence: 1,
        purchaseDate: new Date("2026-08-20T00:00:00Z"),
        description: "PIX ENVIADO PARA GELAGOELA BAR E RESTAURANTE",
        descriptorKey: descriptor.key,
        amount: -190550n,
        status: "POSTED",
        transferId: Number(transfer.id),
      });

      await repositories.updateAccountDescriptor(
        {
          bookId: book.id,
          id: descriptor.id,
          name: "Gelagoela Bar e Restaurante",
        },
        audit(book.id, "account_descriptor", "account_descriptor.updated"),
      );

      const transfers = await repositories.listTransfers(book.id);
      const after = transfers.find((row) => row.id === transfer.id);
      expect(after?.name).toBe("Gelagoela Bar e Restaurante");
    } finally {
      await closeDb(db);
    }
  });
});
