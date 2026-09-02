/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ForbiddenError,
  assertAuthorized,
  assertExecutionContext,
  operations,
} from "./index";

const context = {
  actorId: "user-1",
  bookId: "1",
  role: "OWNER" as const,
  source: "API" as const,
  correlationId: "correlation-1",
};

describe("execution context", () => {
  test("requires every field", () => {
    for (const field of [
      "actorId",
      "bookId",
      "role",
      "source",
      "correlationId",
    ]) {
      const input = { ...context, [field]: "" };
      expect(() => assertExecutionContext(input)).toThrow(new RegExp(field));
    }
  });
});

describe("authorization matrix", () => {
  test("allows read access to every role and financial writes to editors", () => {
    for (const role of ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const) {
      expect(() =>
        assertAuthorized({ ...context, role }, operations.listAccounts),
      ).not.toThrow();
    }
    for (const role of ["OWNER", "ADMIN", "EDITOR"] as const) {
      expect(() =>
        assertAuthorized({ ...context, role }, operations.createExpense),
      ).not.toThrow();
    }
    expect(() =>
      assertAuthorized(
        { ...context, role: "VIEWER" },
        operations.createExpense,
      ),
    ).toThrow(ForbiddenError);
  });

  test("keeps forbidden errors stable", () => {
    expect(() =>
      assertAuthorized(
        { ...context, role: "VIEWER" },
        operations.createAccount,
      ),
    ).toThrow("FORBIDDEN");
  });
});
