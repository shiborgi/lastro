import type { Database } from "@lastro/db";
import { createRepositories } from "@lastro/db";

export type JobHandler = (job: {
  id: string;
  bookId: string;
  type: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

export type WorkerOptions = {
  workerId: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  handlers: Record<string, JobHandler>;
};

export function createWorker(db: Database, options: WorkerOptions) {
  const repositories = createRepositories(db);
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  let running = true;
  let currentJob: { id: string; bookId: string } | null = null;

  async function processOne(now: Date): Promise<boolean> {
    const job = await repositories.claimDueJob(options.workerId, now);
    if (!job) return false;
    currentJob = { id: job.id, bookId: job.bookId };
    const handler = options.handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(job);
      await repositories.completeJob(job.id, job.bookId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextRunAt = new Date(now.getTime() + retryDelayMs);
      await repositories.failJob(
        job.id,
        job.bookId,
        message,
        nextRunAt,
        maxAttempts,
      );
    } finally {
      currentJob = null;
    }
    return true;
  }

  async function run(): Promise<void> {
    while (running) {
      const processed = await processOne(new Date());
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }

  async function shutdown(): Promise<void> {
    running = false;
    if (currentJob) {
      await repositories.releaseJobLease(currentJob.id, currentJob.bookId);
    }
  }

  return { run, shutdown };
}
