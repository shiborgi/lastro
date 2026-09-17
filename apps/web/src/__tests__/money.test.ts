/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { formatAmount } from "@/lib/money";

describe("money formatting", () => {
  test("renders minor units as a grouped decimal", () => {
    expect(formatAmount("123456", "USD")).toBe("1,234.56 USD");
    expect(formatAmount("5", "USD")).toBe("0.05 USD");
    expect(formatAmount("0", "USD")).toBe("0.00 USD");
  });

  test("respects currencies that do not use two decimals", () => {
    expect(formatAmount("1234", "JPY")).toBe("1,234 JPY");
    expect(formatAmount("1234567", "KWD")).toBe("1,234.567 KWD");
  });
});
