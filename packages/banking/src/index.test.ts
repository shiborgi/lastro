/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { isUnchanged, normalizeMovement } from "./index";

describe("banking import normalization", () => {
  test("normalizes a debit into a reviewable movement", () => {
    const movement = normalizeMovement({
      bookId: "1",
      provider: "acme-bank",
      providerAccountId: "acc-1",
      externalReference: "ext-1",
      kind: "DEBIT",
      amountMinor: 100n,
      currency: "USD",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(movement.status).toBe("REVIEW");
    expect(movement.kind).toBe("DEBIT");
    expect(movement.amountMinor).toBe(100n);
  });

  test("rejects invalid movements", () => {
    expect(() =>
      normalizeMovement({
        bookId: "",
        provider: "acme-bank",
        providerAccountId: "acc-1",
        externalReference: "ext-1",
        kind: "DEBIT",
        amountMinor: 100n,
        currency: "USD",
        occurredAt: new Date(),
      }),
    ).toThrow("bookId and provider are required");
    expect(() =>
      normalizeMovement({
        bookId: "1",
        provider: "acme-bank",
        providerAccountId: "acc-1",
        externalReference: "ext-1",
        kind: "DEBIT",
        amountMinor: 0n,
        currency: "USD",
        occurredAt: new Date(),
      }),
    ).toThrow("amountMinor must be positive");
  });

  test("marks a repeated import as unchanged", () => {
    expect(isUnchanged({ status: "UNCHANGED" } as never)).toBe(true);
    expect(isUnchanged({ status: "REVIEW" } as never)).toBe(false);
  });
});
