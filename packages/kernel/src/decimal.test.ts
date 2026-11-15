/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { normalizeQuantity, toMinorUnits } from "./decimal";
import { InvalidMoneyError } from "./errors";

describe("toMinorUnits", () => {
  test("float noise from a point-of-sale export becomes exact cents", () => {
    expect(toMinorUnits("2168.7000000000003")).toBe(216870n);
    expect(toMinorUnits("5558.827413678436")).toBe(555883n);
    expect(toMinorUnits("0.005")).toBe(1n);
    expect(toMinorUnits("-2.8")).toBe(-280n);
  });
  test("rounds half away from zero", () => {
    expect(toMinorUnits("-0.005")).toBe(-1n);
    expect(toMinorUnits("-0.004")).toBe(0n);
    expect(toMinorUnits("1.995")).toBe(200n);
  });
  test("accepts integers, bare fractions, plus sign and other scales", () => {
    expect(toMinorUnits("3")).toBe(300n);
    expect(toMinorUnits(".5")).toBe(50n);
    expect(toMinorUnits("+1.5")).toBe(150n);
    expect(toMinorUnits("1.2345", 3)).toBe(1235n);
    expect(toMinorUnits("7", 0)).toBe(7n);
    expect(toMinorUnits("-0")).toBe(0n);
  });
  test("refuses invalid text and exponents", () => {
    for (const bad of [
      "1e3",
      "1E3",
      "1.2.3",
      "",
      " 1",
      "1 ",
      "abc",
      "-",
      ".",
      "1,5",
    ]) {
      expect(() => toMinorUnits(bad)).toThrow(InvalidMoneyError);
    }
  });
});

describe("normalizeQuantity", () => {
  test("keeps up to six places without trailing zeros", () => {
    expect(normalizeQuantity("0.65")).toBe("0.65");
    expect(normalizeQuantity("2.0000004")).toBe("2");
    expect(normalizeQuantity("2.000000")).toBe("2");
    expect(normalizeQuantity("0.000000")).toBe("0");
    expect(normalizeQuantity("1.1234565")).toBe("1.123457");
    expect(normalizeQuantity("0.9999995")).toBe("1");
    expect(normalizeQuantity("10")).toBe("10");
  });
  test("refuses negatives and invalid text", () => {
    expect(() => normalizeQuantity("-1")).toThrow(Error);
    expect(() => normalizeQuantity("1e3")).toThrow(Error);
    expect(() => normalizeQuantity("")).toThrow(Error);
  });
});
