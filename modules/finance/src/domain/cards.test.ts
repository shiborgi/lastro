/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  cardKeys,
  invoiceMonthOf,
  invoicePaymentKey,
  paymentKeyOf,
  scheduleOf,
  windowOf,
} from "./cards";

const utc = (value: string) => new Date(`${value}T00:00:00Z`);

describe("card statement keys", () => {
  test("the expense key has the count; the payment key, which instalment", () => {
    const keys = cardKeys("9f2c", 12);
    expect(keys.expenseKey).toBe("9f2c-12");
    expect(keys.paymentKey(5)).toBe("9f2c-5/12");
    expect(paymentKeyOf(keys.expenseKey, 6)).toBe("9f2c-6/12");
  });

  test("a repeated identical line keeps its order in the external id", () => {
    expect(cardKeys("9f2c#2", 1).paymentKey(1)).toBe("9f2c#2-1/1");
    expect(paymentKeyOf("9f2c#2-1", 1)).toBe("9f2c#2-1/1");
  });
});

describe("the invoice of each instalment", () => {
  const may = {
    referenceMonth: utc("2026-05-01"),
    startsOn: utc("2026-04-10"),
    endsOn: utc("2026-05-09"),
    dueOn: utc("2026-05-31"),
  };
  const june = {
    referenceMonth: utc("2026-06-01"),
    startsOn: utc("2026-05-10"),
    endsOn: utc("2026-06-09"),
    dueOn: utc("2026-06-17"),
  };

  test("the window holding the purchase names the first invoice; then one month each, due on each window's day", () => {
    const first = windowOf(utc("2026-04-18"), [may, june]);
    expect(first).toBe(may);
    expect(
      scheduleOf(may, 3, [may, june]).map((each) => [
        each.month.toISOString().slice(0, 7),
        each.dueOn.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ["2026-05", "2026-05-31"],
      ["2026-06", "2026-06-17"],
      // July has no window yet: May's due day carried forward, kept in the month.
      ["2026-07", "2026-07-31"],
    ]);
  });

  test("no window, no invoice: nothing is guessed from the calendar", () => {
    expect(invoiceMonthOf(utc("2026-07-01"), [may, june])).toBeNull();
  });

  test("one invoice payment per card and month", () => {
    expect(invoicePaymentKey("4", utc("2026-05-01"))).toBe("card-4-2026-05");
  });
});
