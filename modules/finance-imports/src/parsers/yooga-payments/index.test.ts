/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYoogaPayments } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("Yooga payments report", () => {
  const records = parseYoogaPayments(fixture("day.csv"));

  test("one record per payment method; the TOTAL row is skipped", () => {
    expect(records.map((each) => each.name)).toEqual([
      "Débito",
      "Dinheiro",
      "Pix",
    ]);
  });

  test("reads the day, quantity, paid amount, discount and fee in minor units", () => {
    expect(records[2]).toMatchObject({
      quantity: 3,
      gross: 13495n,
      amount: 14555n,
      discount: 200n,
      fee: 1260n,
    });
    expect(records[2]?.occurredOn.toISOString()).toBe(
      "2026-11-08T00:00:00.000Z",
    );
  });

  test("a TOTAL row written in the data column is skipped too", () => {
    expect(
      parseYoogaPayments(fixture("total-in-date.csv")).map((each) => each.name),
    ).toEqual(["Pix"]);
  });

  test("a report without the data and bruto columns is refused", () => {
    expect(() => parseYoogaPayments(fixture("without-date.csv"))).toThrow(
      'missing column(s) "data", "bruto"',
    );
  });
});
