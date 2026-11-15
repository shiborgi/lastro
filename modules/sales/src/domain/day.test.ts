/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  businessDateOf,
  chooseCost,
  operationalDayCloseInstant,
  operationalDayClosed,
} from "./day";

describe("line cost", () => {
  test("the catalog override wins, then the reported cost, else missing", () => {
    expect(
      chooseCost({ quantity: "3", reportedCost: 1200n, costOverride: 450n }),
    ).toEqual({
      unitCost: 450n,
      cost: 1350n,
      costSource: "CATALOG",
    });
    expect(
      chooseCost({ quantity: "3", reportedCost: 1200n, costOverride: null }),
    ).toEqual({
      unitCost: 400n,
      cost: 1200n,
      costSource: "SALE",
    });
    expect(
      chooseCost({ quantity: "3", reportedCost: 0n, costOverride: null }),
    ).toEqual({
      unitCost: null,
      cost: null,
      costSource: "MISSING",
    });
  });

  test("a fractional quantity rounds half away from zero", () => {
    expect(
      chooseCost({ quantity: "0.333", reportedCost: null, costOverride: 1000n })
        .cost,
    ).toBe(333n);
    expect(
      chooseCost({ quantity: "1.5", reportedCost: null, costOverride: 3n })
        .cost,
    ).toBe(5n);
  });
});

describe("the operational day", () => {
  test("closes at 06:00 São Paulo of the next day", () => {
    expect(operationalDayCloseInstant("2026-11-07").toISOString()).toBe(
      "2026-11-08T09:00:00.000Z",
    );
    expect(
      operationalDayClosed("2026-11-07", new Date("2026-11-08T08:59:59Z")),
    ).toBe(false);
    expect(
      operationalDayClosed("2026-11-07", new Date("2026-11-08T09:00:00Z")),
    ).toBe(true);
  });

  test("an instant before 06:00 local still belongs to the previous day", () => {
    expect(businessDateOf(new Date("2026-11-08T05:00:00Z"))).toBe("2026-11-07");
    expect(businessDateOf(new Date("2026-11-08T10:00:00Z"))).toBe("2026-11-08");
  });
});
