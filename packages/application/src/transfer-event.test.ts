/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { transferKeyFor } from "./transfer-event";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/*
 * The whole point: the two statements that record one transfer have to produce
 * one key. Promotion normalises the direction by the sign before it gets here,
 * so both sides arrive with the payer first — these tests assert what happens
 * once they do, and the promotion tests assert that they do.
 */
describe("one key for one transfer", () => {
  const event = {
    sourceAccountId: "1",
    destinationAccountId: "2",
    amount: 100000n,
    date: day("2026-08-13"),
    occurrence: 1,
  };

  test("both sides agree", () => {
    expect(transferKeyFor(event)).toBe(transferKeyFor({ ...event }));
  });

  test("the direction is part of it: A→B is not B→A", () => {
    expect(transferKeyFor(event)).not.toBe(
      transferKeyFor({
        ...event,
        sourceAccountId: "2",
        destinationAccountId: "1",
      }),
    );
  });

  test("a different amount, day or pair is a different transfer", () => {
    expect(transferKeyFor({ ...event, amount: 100001n })).not.toBe(
      transferKeyFor(event),
    );
    expect(transferKeyFor({ ...event, date: day("2026-08-14") })).not.toBe(
      transferKeyFor(event),
    );
    expect(transferKeyFor({ ...event, destinationAccountId: "3" })).not.toBe(
      transferKeyFor(event),
    );
  });

  /*
   * The case that would otherwise lose money: two transfers of the same amount
   * between the same accounts on the same day. Without the occurrence they
   * hash alike and the second is swallowed by the first.
   */
  test("two identical transfers in one day stay two", () => {
    expect(transferKeyFor({ ...event, occurrence: 2 })).not.toBe(
      transferKeyFor(event),
    );
  });

  test("ignores the time of day, keeping both sides on the same date", () => {
    expect(
      transferKeyFor({ ...event, date: new Date("2026-08-13T23:59:00.000Z") }),
    ).toBe(transferKeyFor(event));
  });
});
