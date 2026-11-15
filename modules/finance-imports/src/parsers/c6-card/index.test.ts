/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseC6Card } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("C6 card invoice", () => {
  const [glass, invoicePaid, school, coffee, again] = parseC6Card(
    fixture("august.csv"),
  );

  test("reads the instalment amount as minor units, keeping the sign", () => {
    expect(glass?.amount).toBe(71666n);
    expect(invoicePaid?.amount).toBe(-982729n);
  });

  test("an instalment keeps its purchase date and says which of how many it is", () => {
    expect(school).toMatchObject({
      installmentNumber: 5,
      installmentCount: 12,
    });
    expect(school?.occurredOn.toISOString()).toBe("2026-04-18T00:00:00.000Z");
    expect(coffee).toMatchObject({ installmentNumber: 1, installmentCount: 1 });
  });

  test("the merchant is the name; the card, holder and issuer's category are kept", () => {
    expect(glass).toMatchObject({
      name: "MP *VIDRACARIA EXEMPLO",
      cardLast4: "1111",
      cardholder: "EMPRESA EXEMPLO",
      providerCategory: "Materiais de construção para casa",
    });
    expect(invoicePaid?.providerCategory).toBeNull();
    expect(invoicePaid).not.toHaveProperty("method");
  });

  test("two identical lines stay two lines", () => {
    expect(again).toEqual(coffee);
  });

  test("refuses a shifted line, naming it", () => {
    expect(() => parseC6Card(fixture("malformed.csv"))).toThrow(
      "expected 9 fields, found 10",
    );
  });
});
