/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { closeDb, createDb, createRepositories, expenses } from "@lastro/db";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

function audit(bookId: string, action: string) {
  return {
    actorType: "USER" as const,
    actorPrincipal: "wave13-user",
    delegatedOperator: "wave13-user",
    bookId,
    source: "API" as const,
    correlationId: randomUUID(),
    action,
    resourceType: "expense_settlement",
    payload: {},
  };
}

describe("WAVE-1.3 PostgreSQL settlement invariants", () => {
  test("enforces Book, currency, allocation, idempotency, void, and audit invariants", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const book = await repositories.createBook("W1.3 Book");
    const otherBook = await repositories.createBook("W1.3 Other Book");
    const account = await repositories.createAccount(
      { bookId: book.id, name: "Checking", type: "CHECKING" },
      audit(book.id, "account.created"),
    );
    const otherAccount = await repositories.createAccount(
      { bookId: otherBook.id, name: "Other checking", type: "CHECKING" },
      audit(otherBook.id, "account.created"),
    );
    const party = await repositories.createParty(
      { bookId: book.id, name: "Vendor", type: "VENDOR" },
      audit(book.id, "party.created"),
    );
    const category = await repositories.createExpenseCategory(
      { bookId: book.id, name: "Supplies" },
      audit(book.id, "expense_category.created"),
    );

    try {
      const [expense] = await db
        .insert(expenses)
        .values({
          bookId: Number(book.id),
          accountId: Number(account.id),
          partyId: Number(party.id),
          expenseCategoryId: Number(category.id),
          amountMinor: 100n,
          currency: "USD",
        })
        .returning();
      const payment = await repositories.createPayment(
        {
          bookId: book.id,
          accountId: account.id,
          amountMinor: 100n,
          currency: "USD",
        },
        audit(book.id, "payment.created"),
      );

      await expect(
        repositories.createExpenseSettlement(
          {
            bookId: otherBook.id,
            expenseId: String(expense.id),
            paymentId: String(payment.id),
            amountMinor: 1n,
            currency: "USD",
          },
          audit(otherBook.id, "expense_settlement.created"),
        ),
      ).rejects.toMatchObject({ code: "23503" });
      expect(otherAccount.bookId).toBe(otherBook.id);

      await expect(
        repositories.createExpenseSettlement(
          {
            bookId: book.id,
            expenseId: String(expense.id),
            paymentId: String(payment.id),
            amountMinor: 1n,
            currency: "EUR",
          },
          audit(book.id, "expense_settlement.created"),
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const settlementAudit = audit(book.id, "expense_settlement.created");
      const first = await repositories.createExpenseSettlement(
        {
          bookId: book.id,
          expenseId: String(expense.id),
          paymentId: String(payment.id),
          amountMinor: 60n,
          currency: "USD",
          idempotencyKey: "settlement-key",
        },
        settlementAudit,
      );
      const replay = await repositories.createExpenseSettlement(
        {
          bookId: book.id,
          expenseId: String(expense.id),
          paymentId: String(payment.id),
          amountMinor: 60n,
          currency: "USD",
          idempotencyKey: "settlement-key",
        },
        audit(book.id, "expense_settlement.created"),
      );
      expect(replay.id).toBe(first.id);

      await expect(
        repositories.createExpenseSettlement(
          {
            bookId: book.id,
            expenseId: String(expense.id),
            paymentId: String(payment.id),
            amountMinor: 41n,
            currency: "USD",
          },
          audit(book.id, "expense_settlement.created"),
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const voided = await repositories.voidExpenseSettlement(
        {
          bookId: book.id,
          id: String(first.id),
          voidedBy: "wave13-user",
          voidReason: "replacement",
        },
        audit(book.id, "expense_settlement.voided"),
      );
      expect(voided.voidedAt).not.toBeNull();
      await expect(
        repositories.voidExpenseSettlement(
          { bookId: book.id, id: String(first.id), voidedBy: "wave13-user" },
          audit(book.id, "expense_settlement.voided"),
        ),
      ).rejects.toThrow("active settlement was not found");

      const replacement = await repositories.createExpenseSettlement(
        {
          bookId: book.id,
          expenseId: String(expense.id),
          paymentId: String(payment.id),
          amountMinor: 100n,
          currency: "USD",
        },
        audit(book.id, "expense_settlement.created"),
      );
      expect(replacement.id).not.toBe(first.id);
      expect(
        await repositories.listAuditEvents(settlementAudit.correlationId),
      ).toHaveLength(1);

      const createExpense = async (amountMinor: bigint) => {
        const [row] = await db
          .insert(expenses)
          .values({
            bookId: Number(book.id),
            accountId: Number(account.id),
            partyId: Number(party.id),
            expenseCategoryId: Number(category.id),
            amountMinor,
            currency: "USD",
          })
          .returning();
        return row;
      };
      const createPayment = (amountMinor: bigint) =>
        repositories.createPayment(
          {
            bookId: book.id,
            accountId: account.id,
            amountMinor,
            currency: "USD",
          },
          audit(book.id, "payment.created"),
        );
      const settle = (
        expenseId: string | number,
        paymentId: string | number,
        amountMinor: bigint,
      ) =>
        repositories.createExpenseSettlement(
          {
            bookId: book.id,
            expenseId: String(expenseId),
            paymentId: String(paymentId),
            amountMinor,
            currency: "USD",
          },
          audit(book.id, "expense_settlement.created"),
        );

      const installmentExpense = await createExpense(90n);
      for (const payment of await Promise.all([
        createPayment(30n),
        createPayment(30n),
        createPayment(30n),
      ])) {
        await settle(installmentExpense.id, payment.id, 30n);
      }

      const firstSplitExpense = await createExpense(40n);
      const secondSplitExpense = await createExpense(40n);
      const sharedPayment = await createPayment(80n);
      await settle(firstSplitExpense.id, sharedPayment.id, 40n);
      await settle(secondSplitExpense.id, sharedPayment.id, 40n);

      const mixedExpense = await createExpense(100n);
      const instantPayment = await createPayment(25n);
      const cardPayment = await createPayment(75n);
      await settle(mixedExpense.id, instantPayment.id, 25n);
      await settle(mixedExpense.id, cardPayment.id, 75n);

      const concurrentExpense = await createExpense(100n);
      const concurrentPayment = await createPayment(100n);
      const race = await Promise.allSettled([
        settle(concurrentExpense.id, concurrentPayment.id, 100n),
        settle(concurrentExpense.id, concurrentPayment.id, 100n),
      ]);
      expect(
        race.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        race.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
    } finally {
      await closeDb(db);
    }
  });
});
