/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { formatAmount, minorUnitDigits, toMinorUnits } from "@/lib/money";

describe("money formatting", () => {
  test("renders minor units as a grouped decimal", () => {
    expect(formatAmount("123456", "USD")).toBe("1,234.56 USD");
    expect(formatAmount("5", "USD")).toBe("0.05 USD");
    expect(formatAmount("0", "USD")).toBe("0.00 USD");
  });

  test("respects currencies that do not use two decimals", () => {
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(formatAmount("1234", "JPY")).toBe("1,234 JPY");
    expect(formatAmount("1234567", "KWD")).toBe("1,234.567 KWD");
  });

  test("round-trips a decimal input back to minor units", () => {
    expect(toMinorUnits("1234.56", "USD")).toBe("123456");
    expect(toMinorUnits("10", "USD")).toBe("1000");
    expect(toMinorUnits("1234", "JPY")).toBe("1234");
  });

  test("rejects input the currency cannot represent", () => {
    expect(() => toMinorUnits("1.234", "USD")).toThrow(/decimal places/);
    expect(() => toMinorUnits("abc", "USD")).toThrow(/positive decimal/);
  });
});
