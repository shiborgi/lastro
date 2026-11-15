/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStoneSales } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("Stone sales export", () => {
  const records = parseStoneSales(fixture("november.csv"));
  const named = (name: string) => records.find((each) => each.name === name);

  test("one record per day, product and brand; only approved sales count", () => {
    expect(records.map((each) => each.name).sort()).toEqual([
      "Credito Visa",
      "Debito MasterCard",
      "Pix QRcode",
    ]);
    // The cancelled credit sale of 30.00 is not in it.
    expect(named("Credito Visa")).toMatchObject({ quantity: 1, gross: 10000n });
  });

  test("a group is summed with six places and rounded once", () => {
    // 15.40 + 55.88 gross; 0.267960 + 0.971432 = 1.239392 → 1.24 kept by Stone.
    expect(named("Debito MasterCard")).toMatchObject({
      quantity: 2,
      gross: 7128n,
      discount: 0n,
      fee: 0n,
      acquirerFee: 124n,
      amount: 7004n,
    });
  });

  test("the gross is the point of sale's, so only the acquirer's fee is recognized here", () => {
    expect(records.every((each) => !each.grossRecognized)).toBe(true);
    expect(named("Debito MasterCard")?.occurredOn.toISOString()).toBe(
      "2026-11-08T00:00:00.000Z",
    );
  });

  test("an approved sale whose gross and discounts do not make the net is refused", () => {
    expect(() => parseStoneSales(fixture("mismatch.csv"))).toThrow(
      "gross and discounts do not make the net",
    );
  });
});
