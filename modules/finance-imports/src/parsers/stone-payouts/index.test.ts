/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStonePayouts } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("Stone payout report", () => {
  const deposits = parseStonePayouts(fixture("month.csv"));

  test("one promised money-in line per deposit, paid or scheduled, keyed by Stone's id", () => {
    expect(deposits.map((each) => each.externalId)).toEqual([
      "202601070000000000001",
      "202601070000000000002",
      "202601090000000000004",
      "202601080000000000003",
    ]);
    expect(deposits.every((each) => each.promise === true)).toBe(true);
  });

  test("reads the day, the amount with its thousands dot, and the mode and brand as printed", () => {
    expect(deposits[0]).toMatchObject({
      amount: 93703n,
      name: "Débito Maestro",
      currency: "BRL",
    });
    expect(deposits[0]?.occurredOn.toISOString()).toBe(
      "2026-01-07T00:00:00.000Z",
    );
    expect(deposits[2]?.amount).toBe(158931n);
  });

  test("another header is refused", () => {
    expect(() => parseStonePayouts("a;b\n1;2\n")).toThrow("missing column");
  });
});
