/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  type Access,
  type Role,
  assertAccess,
  assertExecutionContext,
  canAccess,
} from "./context";
import { ForbiddenError, InvalidExecutionContextError } from "./errors";

const base = {
  actorId: "u1",
  bookId: "1",
  role: "EDITOR",
  source: "MCP",
  correlationId: "c1",
} as const;

describe("execution context", () => {
  test("names the first missing or invalid field", () => {
    expect(assertExecutionContext(base)).toEqual(base);
    for (const field of ["actorId", "bookId", "role", "source"] as const) {
      expect(() => assertExecutionContext({ ...base, [field]: "" })).toThrow(
        InvalidExecutionContextError,
      );
    }
    expect(() => assertExecutionContext({ ...base, role: "ROOT" })).toThrow(
      "role is required",
    );
  });
});

describe("authorization matrix", () => {
  const matrix: Record<Role, Record<Access, boolean>> = {
    OWNER: { read: true, write: true, admin: true },
    ADMIN: { read: true, write: true, admin: true },
    EDITOR: { read: true, write: true, admin: false },
    VIEWER: { read: true, write: false, admin: false },
  };

  test("each role reaches exactly its access levels", () => {
    for (const [role, levels] of Object.entries(matrix)) {
      for (const [access, allowed] of Object.entries(levels)) {
        expect(canAccess(role as Role, access as Access)).toBe(allowed);
      }
    }
  });

  test("a refusal is one stable error", () => {
    expect(() => assertAccess({ ...base, role: "VIEWER" }, "write")).toThrow(
      ForbiddenError,
    );
  });
});
