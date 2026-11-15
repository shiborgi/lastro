/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYoogaSales } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("Yooga sales report", () => {
  const lines = parseYoogaSales(fixture("day.csv"));

  test("one observation per product, on the operational day of data_inicio", () => {
    expect(lines.map((each) => each.code)).toEqual([
      "10931990",
      "10931982",
      "2714403",
    ]);
    expect(lines[0]?.occurredOn.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  test("reads quantity, revenue and cost in minor units; a quoted name keeps its comma", () => {
    expect(lines[0]).toMatchObject({
      name: "Cerveja Original Garrafa 600ml",
      providerCategory: "Cerveja",
      quantity: "86",
      revenue: 162540n,
      cost: 67940n,
    });
    expect(lines[2]?.name).toBe("Voucher 20,00");
  });

  test("a report without the period, or of more than one day, is refused", () => {
    expect(() => parseYoogaSales(fixture("without-period.csv"))).toThrow(
      'missing column(s) "data_inicio", "data_fim"',
    );
    expect(() => parseYoogaSales(fixture("two-days.csv"))).toThrow(
      "not one operational day",
    );
  });
});
