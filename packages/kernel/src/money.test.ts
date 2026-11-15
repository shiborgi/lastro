/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { InvalidMoneyError } from "./errors";
import { addMoney, magnitude, money, requirePositiveMoney } from "./money";

describe("money", () => {
  test("refuses a negative amount and a blank currency", () => {
    expect(money(-1n, "BRL").ok).toBe(false);
    expect(money(1n, " ").ok).toBe(false);
  });

  test("adds within one currency and refuses across two", () => {
    const brl = money(150n, "BRL");
    const usd = money(1n, "USD");
    if (!brl.ok || !usd.ok) throw new Error("fixture");
    expect(addMoney(brl.value, brl.value)).toEqual({
      ok: true,
      value: { amount: 300n, currency: "BRL" },
    });
    expect(addMoney(brl.value, usd.value).ok).toBe(false);
  });

  test("magnitude drops the sign", () => {
    expect(magnitude(-5n)).toBe(5n);
    expect(magnitude(5n)).toBe(5n);
  });

  test("a positive amount needs a three-letter uppercase currency", () => {
    expect(requirePositiveMoney(1n, "BRL")).toEqual({
      amount: 1n,
      currency: "BRL",
    });
    expect(() => requirePositiveMoney(0n, "BRL")).toThrow(InvalidMoneyError);
    expect(() => requirePositiveMoney(1n, "brl")).toThrow(InvalidMoneyError);
  });
});
