/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { statementKeyOf } from "./account-movements";

const on = new Date("2026-01-06T00:00:00Z");

describe("a statement key always reads origin, method, destination, day, amount", () => {
  test("money out of an account: the account is the origin", () => {
    const payment = {
      direction: "PAYMENT",
      accountId: "1",
      occurredOn: on,
    } as const;
    expect(statementKeyOf(payment, { accountId: "3" }, 16500n, "PIX")).toBe(
      "a1-PIX-a3-20260106-16500",
    );
    expect(statementKeyOf(payment, { partyId: "7" }, 16500n, "BOLETO")).toBe(
      "a1-BOLETO-p7-20260106-16500",
    );
  });

  test("money into an account: the account is the destination", () => {
    const receipt = {
      direction: "RECEIPT",
      accountId: "1",
      occurredOn: on,
    } as const;
    expect(statementKeyOf(receipt, { accountId: "3" }, 16500n, "PIX")).toBe(
      "a3-PIX-a1-20260106-16500",
    );
    expect(statementKeyOf(receipt, { partyId: "7" }, 16500n, "PIX")).toBe(
      "p7-PIX-a1-20260106-16500",
    );
  });

  test("both statements of one transfer compute the same key", () => {
    const leavingC6 = {
      direction: "PAYMENT",
      accountId: "3",
      occurredOn: on,
    } as const;
    const arrivingNubank = {
      direction: "RECEIPT",
      accountId: "1",
      occurredOn: on,
    } as const;
    expect(statementKeyOf(leavingC6, { accountId: "1" }, 16500n, "PIX")).toBe(
      statementKeyOf(arrivingNubank, { accountId: "3" }, 16500n, "PIX"),
    );
  });
});
