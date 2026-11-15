/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { fixedCostShare } from "./close";

describe("fixed cost share", () => {
  test("splits evenly with the remainder to the earliest days, summing to the month", () => {
    const shares = [0, 1, 2].map(
      (dayIndex) =>
        fixedCostShare({
          monthFixed: 1000n,
          previousMonthFixed: 0n,
          openDays: 3,
          dayIndex,
          monthClosed: true,
        }).share,
    );
    expect(shares).toEqual([334n, 333n, 333n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });

  test("an open month with nothing recorded borrows the previous month, provisionally", () => {
    expect(
      fixedCostShare({
        monthFixed: 0n,
        previousMonthFixed: 900n,
        openDays: 3,
        dayIndex: 0,
        monthClosed: false,
      }),
    ).toEqual({ share: 300n, provisional: true });
  });

  test("a day outside the month's posted days is a defect", () => {
    expect(() =>
      fixedCostShare({
        monthFixed: 1n,
        previousMonthFixed: 0n,
        openDays: 1,
        dayIndex: 1,
        monthClosed: true,
      }),
    ).toThrow(RangeError);
  });
});
