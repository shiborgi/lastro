/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApplication } from "./index";

const baseContext = {
  actorId: "user-1",
  bookId: "1",
  role: "EDITOR" as const,
  source: "API" as const,
  correlationId: "correlation-1",
};

function fakeRepository() {
  let mutations = 0;
  return {
    get mutations() {
      return mutations;
    },
    createAccount: async () => {
      mutations += 1;
      return { id: "account-1", bookId: "1", name: "Cash", type: "CASH" };
    },
    listAccounts: async (bookId: string) => [
      { id: "account-1", bookId, name: "Cash", type: "CASH" },
    ],
  };
}

describe("financial application commands", () => {
  test("validate context before repository mutation", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);

    await expect(
      application.createAccount({
        context: { ...baseContext, correlationId: "" },
        name: "Cash",
        type: "CASH",
      }),
    ).rejects.toThrow(/correlationId/);
    expect(repository.mutations).toBe(0);
  });

  test("returns only records for the selected Book", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);
    const records = await application.listAccounts({
      ...baseContext,
      bookId: "2",
    });
    expect(records).toEqual([
      { id: "account-1", bookId: "2", name: "Cash", type: "CASH" },
    ]);
  });

  test("forbidden mutations do not reach the repository", async () => {
    const repository = fakeRepository();
    const application = createApplication(repository);
    await expect(
      application.createAccount({
        context: { ...baseContext, role: "VIEWER" },
        name: "Cash",
        type: "CASH",
      }),
    ).rejects.toThrow("FORBIDDEN");
    expect(repository.mutations).toBe(0);
  });
});
