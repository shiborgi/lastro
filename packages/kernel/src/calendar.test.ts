/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  addDays,
  easter,
  isBusinessDay,
  nextBusinessDay,
  rollToBusinessDay,
} from "./calendar";

describe("calendar", () => {
  test("easter", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
  });
  test("non business days", () => {
    expect(isBusinessDay("2026-11-07")).toBe(false); // Saturday
    expect(isBusinessDay("2026-11-20")).toBe(false); // Consciência Negra
    expect(isBusinessDay("2026-02-17")).toBe(false); // Carnaval Tuesday
    expect(isBusinessDay("2026-02-16")).toBe(false); // Carnaval Monday
    expect(isBusinessDay("2026-04-03")).toBe(false); // Good Friday
    expect(isBusinessDay("2026-06-04")).toBe(false); // Corpus Christi
    expect(isBusinessDay("2026-12-25")).toBe(false);
  });
  test("business days", () => {
    expect(isBusinessDay("2026-11-09")).toBe(true);
    expect(isBusinessDay("2026-02-18")).toBe(true); // Ash Wednesday
  });
  test("next and roll", () => {
    expect(nextBusinessDay("2026-11-07")).toBe("2026-11-09");
    expect(nextBusinessDay("2026-11-19")).toBe("2026-11-23");
    expect(nextBusinessDay("2026-11-09")).toBe("2026-11-10");
    expect(rollToBusinessDay("2026-11-09")).toBe("2026-11-09");
    expect(rollToBusinessDay("2026-11-07")).toBe("2026-11-09");
  });
  test("addDays crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
