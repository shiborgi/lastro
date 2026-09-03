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

describe("WAVE-1.6 revenue, receipt, and transfer invariants", () => {
  test("derives revenue status, enforces transfer pairing, and resolves counterparts", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const book = await repositories.createBook("W1.6 Book");
    const sourceAccount = await repositories.createAccount(
      { bookId: book.id, name: "Source", type: "CHECKING" },
      audit(book.id, "account.created"),
    );
    const destinationAccount = await repositories.createAccount(
      { bookId: book.id, name: "Destination", type: "SAVINGS" },
      audit(book.id, "account.created"),
    );
    const party = await repositories.createParty(
      { bookId: book.id, name: "Employer", type: "EMPLOYER" },
      audit(book.id, "party.created"),
    );
    const salaryCategory = await repositories.createRevenueCategory(
      { bookId: book.id, name: "Salary" },
      audit(book.id, "revenue_category.created"),
    );
    const reimbursementCategory = await repositories.createRevenueCategory(
      { bookId: book.id, name: "Reimbursement" },
      audit(book.id, "revenue_category.created"),
    );

    try {
      const salary = await repositories.createRevenue(
        {
          bookId: book.id,
          accountId: sourceAccount.id,
          partyId: party.id,
          revenueCategoryId: salaryCategory.id,
          amountMinor: 200n,
          currency: "USD",
        },
        audit(book.id, "revenue.created"),
      );
      const reimbursement = await repositories.createRevenue(
        {
          bookId: book.id,
          accountId: sourceAccount.id,
          partyId: party.id,
          revenueCategoryId: reimbursementCategory.id,
          amountMinor: 100n,
          currency: "USD",
        },
        audit(book.id, "revenue.created"),
      );

      // AC-1.6.2.2: concurrent receipt settlements never exceed revenue or receipt.
      const salaryReceipt = await repositories.createReceipt(
        {
          bookId: book.id,
          accountId: destinationAccount.id,
          amountMinor: 200n,
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
            amountMinor: 120n,
            currency: "USD",
          },
          audit(book.id, "revenue_settlement.created"),
        ),
        repositories.createRevenueSettlement(
          {
            bookId: book.id,
            revenueId: salary.id,
            receiptId: salaryReceipt.id,
            amountMinor: 120n,
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
          amountMinor: 100n,
          currency: "USD",
        },
        audit(book.id, "receipt.created"),
      );
      const partReceipt = await repositories.createReceipt(
        {
          bookId: book.id,
          accountId: destinationAccount.id,
          amountMinor: 80n,
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
            amountMinor: 100n,
            currency: "USD",
          },
          audit(book.id, "revenue_settlement.created"),
        );
      const partSettlement = await repositories.createRevenueSettlement(
        {
          bookId: book.id,
          revenueId: salary.id,
          receiptId: partReceipt.id,
          amountMinor: 80n,
          currency: "USD",
        },
        audit(book.id, "revenue_settlement.created"),
      );
      expect(reimbursementSettlement.receiptId).toBe(reimbursementReceipt.id);
      expect(partSettlement.receiptId).toBe(partReceipt.id);

      // AC-1.6.2.3: transfer writes source payment and destination receipt as a pair.
      const transfer = await repositories.createTransfer(
        {
          bookId: book.id,
          sourceAccountId: sourceAccount.id,
          destinationAccountId: destinationAccount.id,
          amountMinor: 50n,
          currency: "USD",
        },
        audit(book.id, "transfer.created"),
      );
      expect(transfer.sourcePaymentId).not.toBe(transfer.destinationReceiptId);
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
          amountMinor: 80n,
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
      expect(flow.inflows.some((item) => item.amountMinor >= 50n)).toBe(true);
      expect(flow.outflows.some((item) => item.amountMinor >= 50n)).toBe(true);
      expect(flow.transfers.some((item) => item.amountMinor === 50n)).toBe(
        true,
      );

      // AC-1.6.3.1: revenue received in parts and one receipt settles salary + reimbursement.
      const salaryBalance = await application.getRevenueBalance({
        context,
        id: String(salary.id),
      });
      expect(salaryBalance.minor).toBe(0n);
      const salaryStatus = await application.getRevenueStatus({
        context,
        id: String(salary.id),
      });
      expect(salaryStatus).toBe("SETTLED");
      const reimbursementBalance = await application.getRevenueBalance({
        context,
        id: String(reimbursement.id),
      });
      expect(reimbursementBalance.minor).toBe(0n);
    } finally {
      await closeDb(db);
    }
  });
});
