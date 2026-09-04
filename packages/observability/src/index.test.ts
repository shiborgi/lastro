/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { formatLog, sanitize } from "./index";

describe("observability", () => {
  test("redacts credentials and sensitive payloads", () => {
    const safe = sanitize({
      level: "info",
      message: "request",
      correlationId: "corr-1",
      authorization: "Bearer secret-token",
      secretHash: "abc",
      amountMinor: "100",
    });
    expect(safe.authorization).toBe("[REDACTED]");
    expect(safe.secretHash).toBe("[REDACTED]");
    expect(safe.amountMinor).toBe("100");
  });

  test("exposes correlation, duration, failure, and tool cost without financial text", () => {
    const line = formatLog({
      level: "error",
      message: "job failed",
      correlationId: "corr-1",
      durationMs: 42,
      failure: "timeout",
      idempotencyConflict: true,
      accessViolation: false,
      toolCost: 0.5,
    });
    expect(line).toContain("corr-1");
    expect(line).toContain("42");
    expect(line).toContain("timeout");
    expect(line).toContain("0.5");
  });
});
