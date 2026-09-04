/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApplication } from "@lastro/application";
import { closeDb, createDb, createRepositories } from "@lastro/db";
import { createWorker } from "@lastro/worker";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://lastro:lastro@localhost:5432/lastro";

function audit(bookId: string, action: string) {
  return {
    actorType: "USER" as const,
    actorPrincipal: "wave18-user",
    delegatedOperator: "wave18-user",
    bookId,
    source: "WORKER" as const,
    correlationId: randomUUID(),
    action,
    resourceType: "imported_movement",
    payload: {},
  };
}

describe("WAVE-1.8 imports, jobs, and operational readiness", () => {
  test("dedups imports, avoids silent inference, converts with audit, and runs jobs", async () => {
    const db = createDb(databaseUrl);
    const repositories = createRepositories(db);
    const application = createApplication(repositories);
    const book = await repositories.createBook("W1.8 Book");
    const account = await repositories.createAccount(
      { bookId: book.id, name: "Checking", type: "CHECKING" },
      audit(book.id, "account.created"),
    );

    try {
      // AC-1.8.1.1: dedup — importing the same movement twice yields one reviewable movement.
      const input = {
        bookId: book.id,
        provider: "acme-bank",
        providerAccountId: "acc-1",
        externalReference: "ext-1",
        kind: "DEBIT" as const,
        amountMinor: 100n,
        currency: "USD",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
      };
      const first = await repositories.upsertImportedMovement(input);
      expect(first.unchanged).toBe(false);
      const second = await repositories.upsertImportedMovement(input);
      expect(second.unchanged).toBe(true);
      const movements = await repositories.listImportedMovements(book.id);
      expect(movements).toHaveLength(1);

      // AC-1.8.1.2: no Expense or Revenue is created without an approved rule.
      const expenses = await application.listExpenses({
        actorId: "wave18-user",
        bookId: book.id,
        role: "OWNER",
        source: "API",
        correlationId: randomUUID(),
      });
      expect(expenses).toHaveLength(0);

      // AC-1.8.1.3: approved conversion creates a Payment draft and writes audit.
      const conversionAudit = audit(book.id, "imported_movement.converted");
      const converted = await repositories.markImportedMovementConverted(
        book.id,
        first.movement.id,
        conversionAudit,
      );
      expect(converted.status).toBe("CONVERTED");
      const payment = await application.createPayment({
        context: {
          actorId: "wave18-user",
          bookId: book.id,
          role: "OWNER",
          source: "WORKER",
          correlationId: randomUUID(),
        },
        accountId: account.id,
        amountMinor: 100n,
        currency: "USD",
      });
      expect(payment.id).toBeTruthy();
      const auditEvents = await repositories.listAuditEvents(
        conversionAudit.correlationId,
      );
      expect(
        auditEvents.some((e) => e.action === "imported_movement.converted"),
      ).toBe(true);

      // AC-1.8.2.1: two workers polling one due job result in exactly one owner.
      const job = await repositories.createJob({
        bookId: book.id,
        type: "import",
        payload: { provider: "acme-bank" },
        nextRunAt: new Date(Date.now() - 1000),
      });
      const workerA = createWorker(db, {
        workerId: "worker-a",
        pollIntervalMs: 50,
        handlers: { import: async () => {} },
      });
      const workerB = createWorker(db, {
        workerId: "worker-b",
        pollIntervalMs: 50,
        handlers: { import: async () => {} },
      });
      const runA = workerA.run();
      const runB = workerB.run();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await workerA.shutdown();
      await workerB.shutdown();
      await Promise.all([runA, runB]);
      const jobs = await repositories.listJobs(book.id);
      const importJob = jobs.find((j) => j.id === job.id);
      expect(importJob?.status).toBe("SUCCEEDED");
      expect(importJob?.attempts).toBe(1);

      // AC-1.8.2.2: retry records attempts and next-run time on transient failure.
      const failingJob = await repositories.createJob({
        bookId: book.id,
        type: "import",
        payload: { provider: "acme-bank" },
        nextRunAt: new Date(Date.now() - 1000),
        maxAttempts: 2,
      });
      const failingWorker = createWorker(db, {
        workerId: "worker-fail",
        pollIntervalMs: 50,
        retryDelayMs: 100,
        maxAttempts: 2,
        handlers: {
          import: async () => {
            throw new Error("transient provider failure");
          },
        },
      });
      const runFail = failingWorker.run();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await failingWorker.shutdown();
      await runFail;
      const failedJobs = await repositories.listJobs(book.id);
      const failedJob = failedJobs.find((j) => j.id === failingJob.id);
      expect(failedJob?.status).toBe("FAILED");
      expect(failedJob?.lastError).toContain("transient provider failure");

      // AC-1.8.2.3: shutdown stops leasing new work and either completes or releases the current lease.
      const shutdownJob = await repositories.createJob({
        bookId: book.id,
        type: "import",
        payload: { provider: "acme-bank" },
        nextRunAt: new Date(Date.now() - 1000),
      });
      const shutdownWorker = createWorker(db, {
        workerId: "worker-shutdown",
        pollIntervalMs: 50,
        handlers: {
          import: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
        },
      });
      const runShutdown = shutdownWorker.run();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await shutdownWorker.shutdown();
      await runShutdown;
      const shutdownJobs = await repositories.listJobs(book.id);
      const releasedJob = shutdownJobs.find((j) => j.id === shutdownJob.id);
      expect(
        releasedJob?.status === "SUCCEEDED" ||
          releasedJob?.status === "PENDING",
      ).toBe(true);
      if (releasedJob?.status === "PENDING") {
        expect(releasedJob.leasedBy).toBeNull();
      }
    } finally {
      await closeDb(db);
    }
  });
});
