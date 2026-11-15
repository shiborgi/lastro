/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStoneAccount } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("Stone account statement", () => {
  const lines = parseStoneAccount(fixture("month.csv"));

  test("the Pix sent, one each, and the day's Pix sales net of Stone's fee, summed; a Pix received is skipped", () => {
    // 48,18 − 0,36 + 90,37 − 0,67 = 137,52 on 08/11.
    expect(lines.map((each) => each.amount)).toEqual([
      -300975n,
      -30578n,
      13752n,
    ]);
    expect(lines[2]).toMatchObject({
      externalId: null,
      name: "Transação",
      line: "2026-11-08;Transação",
    });
  });

  test("the name is the destination as printed; the line is hashed by finance", () => {
    expect(lines[0]).toMatchObject({
      externalId: null,
      name: "Pix EMPRESA EXEMPLO LTDA Banco C6 S.A.",
    });
    expect(lines[0]?.line).toContain("16:28:27.226");
  });

  test("the time is São Paulo's, to the millisecond", () => {
    expect(lines[0]?.occurredAt?.toISOString()).toBe(
      "2026-11-09T19:28:27.226Z",
    );
    expect(lines[0]?.occurredOn.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});
