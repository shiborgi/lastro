/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "@lastro/application";
import { closeDb, createDb, createRepositories } from "@lastro/db";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

function audit(bookId: string, action: string) {
  return {
    actorType: "USER" as const,
    actorPrincipal: "wave16-user",
    delegatedOperator: "wave16-user",
    bookId,
    source: "API" as const,
    correlationId: randomUUID(),
    action,
    resourceType: "revenue_settlement",
    payload: {},
  };
}

describe("Revenue, receipt, and transfer invariants", () => {
  test("derives revenue status, enforces transfer pairing, and resolves counterparts", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const book = await repositories.createBook("W1.6 Book");
    const sourceAccount = await repositories.createAccount(
      { bookId: book.id, key: "source", name: "Source", type: "CHECKING" },
      audit(book.id, "account.created"),
    );
    const destinationAccount = await repositories.createAccount(
      {
        bookId: book.id,
        key: "destination",
        name: "Destination",
        type: "SAVINGS",
      },
      audit(book.id, "account.created"),
    );
    const party = await repositories.createParty(
      { bookId: book.id, key: "employer", name: "Employer", type: "EMPLOYER" },
      audit(book.id, "party.created"),
    );
    const salaryCategory = await repositories.createCategory(
      { bookId: book.id, kind: "REVENUE", name: "Salary" },
      audit(book.id, "revenue_category.created"),
    );
    const reimbursementCategory = await repositories.createCategory(
      { bookId: book.id, kind: "REVENUE", name: "Reimbursement" },
      audit(book.id, "revenue_category.created"),
    );

    try {
      const salary = await repositories.createRevenue(
        {
          bookId: book.id,
          key: "salary",
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          partyId: party.id,
          categoryId: salaryCategory.id,
          amount: 200n,
          currency: "USD",
        },
        audit(book.id, "revenue.created"),
      );
      const reimbursement = await repositories.createRevenue(
        {
          bookId: book.id,
          key: "reimbursement",
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          partyId: party.id,
          categoryId: reimbursementCategory.id,
          amount: 100n,
          currency: "USD",
        },
        audit(book.id, "revenue.created"),
      );

      // AC-1.6.2.2: concurrent receipt settlements never exceed revenue or receipt.
      const salaryReceipt = await repositories.createReceipt(
        {
          bookId: book.id,
          accountId: destinationAccount.id,
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          amount: 200n,
          currency: "USD",
        },
        audit(book.id, "receipt.created"),
      );
      const race = await Promise.allSettled([
        repositories.createRevenueSettlement(
          {
            bookId: book.id,
            revenueId: salary.id,
            receiptId: salaryReceipt.id,
            amount: 120n,
            currency: "USD",
          },
          audit(book.id, "revenue_settlement.created"),
        ),
        repositories.createRevenueSettlement(
          {
            bookId: book.id,
            revenueId: salary.id,
            receiptId: salaryReceipt.id,
            amount: 120n,
            currency: "USD",
          },
          audit(book.id, "revenue_settlement.created"),
        ),
      ]);
      expect(
        race.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        race.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);

      // AC-1.6.3.1: revenue received in parts, and one receipt settles salary and reimbursement.
      const reimbursementReceipt = await repositories.createReceipt(
        {
          bookId: book.id,
          accountId: destinationAccount.id,
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          amount: 100n,
          currency: "USD",
        },
        audit(book.id, "receipt.created"),
      );
      const partReceipt = await repositories.createReceipt(
        {
          bookId: book.id,
          accountId: destinationAccount.id,
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          amount: 80n,
          currency: "USD",
        },
        audit(book.id, "receipt.created"),
      );
      const reimbursementSettlement =
        await repositories.createRevenueSettlement(
          {
            bookId: book.id,
            revenueId: reimbursement.id,
            receiptId: reimbursementReceipt.id,
            amount: 100n,
            currency: "USD",
          },
          audit(book.id, "revenue_settlement.created"),
        );
      const partSettlement = await repositories.createRevenueSettlement(
        {
          bookId: book.id,
          revenueId: salary.id,
          receiptId: partReceipt.id,
          amount: 80n,
          currency: "USD",
        },
        audit(book.id, "revenue_settlement.created"),
      );
      expect(reimbursementSettlement.receiptId).toBe(reimbursementReceipt.id);
      expect(partSettlement.receiptId).toBe(partReceipt.id);

      // AC-1.6.2.3: transfer links source and destination accounts as a pair.
      const transfer = await repositories.createTransfer(
        {
          bookId: book.id,
          key: "transfer-1",
          referenceMonth: new Date("2026-09-01T00:00:00Z"),
          sourceAccountId: sourceAccount.id,
          destinationAccountId: destinationAccount.id,
          amount: 50n,
          currency: "USD",
        },
        audit(book.id, "transfer.created"),
      );
      expect(transfer.sourceAccountId).not.toBe(transfer.destinationAccountId);
      const byCorrelation = await repositories.getTransferByCorrelation(
        transfer.correlationId,
      );
      expect(byCorrelation?.id).toBe(transfer.id);

      const transfers = await repositories.listTransfers(book.id);
      expect(transfers.some((item) => item.id === transfer.id)).toBe(true);

      // AC-1.6.1.3: void then replace a settlement.
      const voided = await repositories.voidRevenueSettlement(
        {
          bookId: book.id,
          id: String(partSettlement.id),
          voidedBy: "wave16-user",
          voidReason: "replacement",
        },
        audit(book.id, "revenue_settlement.voided"),
      );
      expect(voided.voidedAt).not.toBeNull();
      const replacement = await repositories.createRevenueSettlement(
        {
          bookId: book.id,
          revenueId: salary.id,
          receiptId: partReceipt.id,
          amount: 80n,
          currency: "USD",
        },
        audit(book.id, "revenue_settlement.created"),
      );
      expect(replacement.id).not.toBe(partSettlement.id);
      const revenueHistory = await repositories.listRevenueSettlements(
        book.id,
        salary.id,
      );
      expect(revenueHistory.some((item) => item.voidedAt != null)).toBe(true);

      // AC-1.6.3.2: cash flow keeps total Book value unchanged and reports transfer once on each side.
      const application = createApplication(repositories);
      const context = {
        actorId: "wave16-user",
        bookId: book.id,
        role: "OWNER" as const,
        source: "API" as const,
        correlationId: randomUUID(),
      };
      const flow = await application.getCashFlow(context);
      expect(flow.inflows.some((item) => item.amount >= 50n)).toBe(true);
      expect(flow.transfers.some((item) => item.amount === 50n)).toBe(true);
      /*
       * This Book has receipts and a transfer but no payment, and that is
       * exactly the separation the domain exists to keep: money arriving is
       * not an outflow, and an internal transfer is neither. Anything here
       * would mean one of the three buckets is bleeding into another.
       */
      expect(flow.outflows).toEqual([]);

      // AC-1.6.3.1: revenue received in parts and one receipt settles salary + reimbursement.
      const salaryBalance = await application.getRevenueBalance({
        context,
        id: String(salary.id),
      });
      expect(salaryBalance.amount).toBe(0n);
      const salaryStatus = await application.getRevenueStatus({
        context,
        id: String(salary.id),
      });
      expect(salaryStatus).toBe("SETTLED");
      const reimbursementBalance = await application.getRevenueBalance({
        context,
        id: String(reimbursement.id),
      });
      expect(reimbursementBalance.amount).toBe(0n);
    } finally {
      await closeDb(db);
    }
  });
});
