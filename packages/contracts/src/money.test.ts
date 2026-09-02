/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { fromMinorUnits, toMinorUnits } from "./money";

describe("money codec", () => {
  test("parses decimal minor-unit string to bigint", () => {
    expect(toMinorUnits("100")).toBe(100n);
    expect(toMinorUnits("-42")).toBe(-42n);
  });

  test("rejects JS number", () => {
    expect(() => toMinorUnits(100 as unknown as string)).toThrow();
  });

  test("roundtrips via from/to", () => {
    expect(fromMinorUnits(toMinorUnits("12345"))).toBe("12345");
  });
});
