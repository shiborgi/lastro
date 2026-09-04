import { createDb } from "@lastro/db";
import { createWorker } from "./index";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createDb(databaseUrl);
// No production job handlers are registered yet, so the loop polls and sleeps
// until handlers land. Jobs with an unknown type fail closed inside
// createWorker instead of running.
const worker = createWorker(db, {
  workerId: process.env.WORKER_ID ?? "worker-1",
  handlers: {},
});

const shutdown = async () => {
  await worker.shutdown();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// run() only resolves after shutdown(); anything else (e.g. a lost database
// connection during boot) is retried with backoff instead of exiting.
for (;;) {
  try {
    await worker.run();
    break;
  } catch (error) {
    console.error(
      `worker loop failed, retrying: ${error instanceof Error ? error.message : error}`,
    );
    await Bun.sleep(5000);
  }
}
