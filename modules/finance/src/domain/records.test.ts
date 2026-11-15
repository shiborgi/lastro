/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  SignedItemError,
  assertInstallment,
  paymentDiscount,
  settlementPosition,
} from "./records";

const active = (amount: bigint) => ({ amount, voidedAt: null });
const voided = (amount: bigint) => ({ amount, voidedAt: new Date() });

describe("settlement position", () => {
  test("open, partial and settled, ignoring voided settlements", () => {
    expect(settlementPosition(1000n, [])).toEqual({
      settled: 0n,
      outstanding: 1000n,
      status: "OPEN",
    });
    expect(settlementPosition(1000n, [active(400n), voided(600n)])).toEqual({
      settled: 400n,
      outstanding: 600n,
      status: "PARTIALLY_SETTLED",
    });
    expect(settlementPosition(1000n, [active(400n), active(600n)]).status).toBe(
      "SETTLED",
    );
  });

  test("a deduction's outstanding keeps its sign", () => {
    expect(settlementPosition(-50n, [active(-20n)])).toEqual({
      settled: -20n,
      outstanding: -30n,
      status: "PARTIALLY_SETTLED",
    });
  });

  test("a settlement against its item's sign is refused", () => {
    expect(() => settlementPosition(100n, [active(-1n)])).toThrow(
      SignedItemError,
    );
  });
});

describe("payment discount", () => {
  test("is the negative of a positive discount within the share", () => {
    expect(paymentDiscount(1000n, 50n)).toBe(-50n);
    expect(paymentDiscount(1000n, 1000n)).toBe(-1000n);
    for (const [share, discount] of [
      [1000n, 0n],
      [1000n, 1001n],
      [0n, 1n],
    ] as const) {
      expect(() => paymentDiscount(share, discount)).toThrow(SignedItemError);
    }
  });
});

describe("installments", () => {
  test("number within one and the count", () => {
    expect(() => assertInstallment(1, 1)).not.toThrow();
    expect(() => assertInstallment(3, 2)).toThrow(SignedItemError);
    expect(() => assertInstallment(0, 2)).toThrow(SignedItemError);
  });
});
