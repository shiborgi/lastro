/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createWorker } from "./index";

function fakeDb() {
  const state: Record<string, unknown> = {};
  return {
    state,
    // The worker only needs createRepositories(db); we stub the repository methods
    // by providing a minimal db object that createRepositories can read. Since
    // createRepositories uses drizzle queries, we instead test the worker's
    // shutdown/lease logic via a hand-rolled repository seam is not possible
    // without a real db. This test asserts the worker factory is constructible
    // and exposes run/shutdown.
  };
}

describe("worker", () => {
  test("createWorker returns run and shutdown", () => {
    const db = fakeDb() as never;
    const worker = createWorker(db, {
      workerId: "worker-1",
      handlers: { import: async () => {} },
    });
    expect(typeof worker.run).toBe("function");
    expect(typeof worker.shutdown).toBe("function");
  });
});
