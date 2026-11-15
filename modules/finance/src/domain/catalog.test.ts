/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { isDeduction } from "./catalog";

const categories = [
  { id: "deductions", kind: "REVENUE", role: "DEDUCTION", parentId: null },
  { id: "fee", kind: "REVENUE", role: null, parentId: "deductions" },
  { id: "income", kind: "REVENUE", role: null, parentId: null },
  { id: "discount", kind: "EXPENSE", role: "DEDUCTION", parentId: null },
] as const;

describe("deduction categories", () => {
  test("a deduction role is the category's own or its group's", () => {
    expect(isDeduction("deductions", categories)).toBe(true);
    expect(isDeduction("fee", categories)).toBe(true);
    expect(isDeduction("income", categories)).toBe(false);
    expect(isDeduction("missing", categories)).toBe(false);
  });
});
