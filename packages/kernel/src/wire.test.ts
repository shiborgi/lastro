/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { Amount, CalendarDateInput, paginate, toAmount, toWire } from "./wire";

describe("wire primitives", () => {
  test("an amount is a decimal string and never a number", () => {
    expect(Amount.safeParse("100").success).toBe(true);
    expect(Amount.safeParse(100).success).toBe(false);
    expect(Amount.safeParse("1.00").success).toBe(false);
    expect(toAmount("-250")).toBe(-250n);
  });

  test("a calendar date input keeps only the day of an ISO instant", () => {
    expect(CalendarDateInput.parse("2026-11-07")).toBe("2026-11-07");
    expect(CalendarDateInput.parse("2026-11-07T00:00:00.000Z")).toBe(
      "2026-11-07",
    );
  });
});

describe("toWire", () => {
  test("bigint becomes text, dates follow their field name, undefined is dropped", () => {
    const instant = new Date("2026-11-07T15:30:00.000Z");
    expect(
      toWire({
        id: "7",
        amount: -1500n,
        dueOn: instant,
        paidAt: instant,
        referenceMonth: instant,
        voidedAt: null,
        name: undefined,
        items: [{ amount: 1n, occurredOn: instant }],
      }),
    ).toEqual({
      id: "7",
      amount: "-1500",
      dueOn: "2026-11-07",
      paidAt: "2026-11-07T15:30:00.000Z",
      referenceMonth: "2026-11-07",
      voidedAt: null,
      items: [{ amount: "1", occurredOn: "2026-11-07" }],
    });
  });
});

describe("paginate", () => {
  const items = ["3", "1", "2"].map((id) => ({ id }));

  test("orders by id and names the next cursor only when the page is full", () => {
    expect(paginate(items, undefined, 2)).toEqual({
      items: [{ id: "1" }, { id: "2" }],
      nextCursor: "2",
    });
    expect(paginate(items, "2", 2)).toEqual({
      items: [{ id: "3" }],
      nextCursor: null,
    });
  });
});
