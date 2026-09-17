/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { fromAmount, toAmount } from "./money";

describe("money codec", () => {
  test("parses decimal amount string to bigint", () => {
    expect(toAmount("100")).toBe(100n);
    expect(toAmount("-42")).toBe(-42n);
  });

  test("rejects JS number", () => {
    expect(() => toAmount(100 as unknown as string)).toThrow();
  });

  test("roundtrips via from/to", () => {
    expect(fromAmount(toAmount("12345"))).toBe("12345");
  });
});
