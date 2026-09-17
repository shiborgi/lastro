/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  type ReferenceWindow,
  addMonths,
  paymentKeyFor,
  referenceMonthFor,
  scheduleFor,
  splitAmount,
} from "./card-schedule";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/* The window actually registered for the C6 card's September invoice. */
const SEPTEMBER: ReferenceWindow = {
  referenceMonth: day("2026-09-01"),
  startDate: day("2026-08-09"),
  endDate: day("2026-09-08"),
};
const OCTOBER: ReferenceWindow = {
  referenceMonth: day("2026-10-01"),
  startDate: day("2026-09-09"),
  endDate: day("2026-10-08"),
};
const WINDOWS = [SEPTEMBER, OCTOBER];

describe("which invoice a purchase lands on", () => {
  test("the window that contains the date", () => {
    const found = referenceMonthFor(day("2026-08-15"), WINDOWS);
    expect(found.referenceMonth.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(found.fromWindow).toBe(true);
  });

  /*
   * The two ends are the cases a half-open comparison gets wrong, and the ones
   * that matter: a purchase made on the closing day belongs to that invoice,
   * and the next day belongs to the next.
   */
  test("includes both ends of the window", () => {
    expect(
      referenceMonthFor(
        day("2026-08-09"),
        WINDOWS,
      ).referenceMonth.toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(
      referenceMonthFor(
        day("2026-09-08"),
        WINDOWS,
      ).referenceMonth.toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(
      referenceMonthFor(
        day("2026-09-09"),
        WINDOWS,
      ).referenceMonth.toISOString(),
    ).toBe("2026-10-01T00:00:00.000Z");
  });

  /*
   * The fallback, and why it is a fallback rather than a refusal: a purchase
   * from before the windows were registered still has to be promotable, and
   * its own month is right whenever the cycle is calendar-aligned.
   */
  test("falls back to the purchase's own month with no window on record", () => {
    const found = referenceMonthFor(day("2026-04-18"), WINDOWS);
    expect(found.referenceMonth.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(found.fromWindow).toBe(false);
  });

  test("and with no windows at all", () => {
    expect(
      referenceMonthFor(day("2026-04-18"), []).referenceMonth.toISOString(),
    ).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("the instalment schedule", () => {
  test("one entry for a purchase in full", () => {
    const schedule = scheduleFor(day("2026-08-15"), 1, WINDOWS);
    expect(schedule).toEqual([
      {
        installmentNumber: 1,
        installmentCount: 1,
        referenceMonth: day("2026-09-01"),
      },
    ]);
  });

  test("one month per instalment, starting at the purchase's invoice", () => {
    const schedule = scheduleFor(day("2026-08-15"), 3, WINDOWS);
    expect(
      schedule.map((i) => i.referenceMonth.toISOString().slice(0, 7)),
    ).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(schedule.map((i) => i.installmentNumber)).toEqual([1, 2, 3]);
  });

  /* The real 12× purchase on the measured invoice: bought in April, so with no
   * window registered for April it starts there and runs into the next year. */
  test("carries the year across December", () => {
    const schedule = scheduleFor(day("2026-04-18"), 12, WINDOWS);
    expect(schedule[0]?.referenceMonth.toISOString().slice(0, 7)).toBe(
      "2026-04",
    );
    expect(schedule[11]?.referenceMonth.toISOString().slice(0, 7)).toBe(
      "2027-03",
    );
  });

  test("treats a nonsense count as a single instalment", () => {
    expect(scheduleFor(day("2026-08-15"), 0, WINDOWS)).toHaveLength(1);
    expect(scheduleFor(day("2026-08-15"), -3, WINDOWS)).toHaveLength(1);
  });

  test("addMonths keeps the first of the month", () => {
    expect(addMonths(day("2026-11-01"), 3).toISOString()).toBe(
      "2027-02-01T00:00:00.000Z",
    );
  });
});

/*
 * The property that matters more than the individual parts: they add back up
 * to the total. Settlements that miss the expense by a cent make a ledger that
 * cannot close, and the trigger guarding the total would reject the last one.
 */
describe("splitting the total", () => {
  test("divides evenly when it divides evenly", () => {
    expect(splitAmount(30000n, 3)).toEqual([10000n, 10000n, 10000n]);
  });

  test("puts the remainder on the first, as issuers do", () => {
    expect(splitAmount(10000n, 3)).toEqual([3334n, 3333n, 3333n]);
  });

  test("always sums to the total", () => {
    for (const total of [1n, 7n, 100n, 434496n, 999999n]) {
      for (const count of [1, 2, 3, 5, 7, 12]) {
        const parts = splitAmount(total, count);
        expect(parts).toHaveLength(count);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      }
    }
  });
});

/*
 * One bill a month, whatever it carries. Two purchases on the same invoice
 * have to produce the same key, or the month gets a second payment and the
 * card looks paid twice.
 */
describe("the payment key", () => {
  test("is the account and the month, nothing else", () => {
    expect(paymentKeyFor("3", day("2026-09-01"))).toBe("card-3-2026-09");
  });

  test("is the same for any day inside the month", () => {
    expect(paymentKeyFor("3", day("2026-09-30"))).toBe(
      paymentKeyFor("3", day("2026-09-01")),
    );
  });

  test("separates two cards in the same month", () => {
    expect(paymentKeyFor("3", day("2026-09-01"))).not.toBe(
      paymentKeyFor("4", day("2026-09-01")),
    );
  });
});
