/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { dayOf, receiptMethodFor, revenueKeyFor } from "./receipt-day";

const at = (iso: string) => new Date(iso);

describe("a day's earnings", () => {
  test("is one key for one payer on one day", () => {
    expect(revenueKeyFor("1", "7", at("2026-09-08T00:00:00.000Z"))).toBe(
      "recv-1-7-2026-09-08",
    );
  });

  /*
   * The case the aggregation exists for: Stone settles a day's sales in six
   * lines, one per flag and function. All six have to reach one revenue.
   */
  test("is the same key whatever time of day the line carries", () => {
    const morning = revenueKeyFor("1", "7", at("2026-09-08T00:00:00.000Z"));
    const evening = revenueKeyFor("1", "7", at("2026-09-08T23:59:59.000Z"));
    expect(morning).toBe(evening);
  });

  /*
   * And the case it must not swallow: two payers settling on one day are two
   * earnings from two payers, and merging them makes a revenue no single
   * relationship explains.
   */
  test("separates two payers on the same day", () => {
    expect(revenueKeyFor("1", "7", at("2026-09-08T00:00:00.000Z"))).not.toBe(
      revenueKeyFor("1", "9", at("2026-09-08T00:00:00.000Z")),
    );
  });

  test("separates two accounts, and two days", () => {
    expect(revenueKeyFor("1", "7", at("2026-09-08T00:00:00.000Z"))).not.toBe(
      revenueKeyFor("2", "7", at("2026-09-08T00:00:00.000Z")),
    );
    expect(revenueKeyFor("1", "7", at("2026-09-08T00:00:00.000Z"))).not.toBe(
      revenueKeyFor("1", "7", at("2026-09-09T00:00:00.000Z")),
    );
  });

  test("reads the day in UTC, so it cannot shift by a timezone", () => {
    expect(dayOf(at("2026-09-08T23:30:00.000Z"))).toBe("2026-09-08");
    expect(dayOf(at("2026-09-09T00:30:00.000Z"))).toBe("2026-09-09");
  });
});

/*
 * Two answers only, and the reason is acquiring rather than laziness: the
 * descriptor may have read DEBIT_CARD off "CART. DEBIT - Stone Pagamento -
 * Maestro", which is true of how the customer paid — but what reaches the
 * account is Stone's deposit, and a deposit arrives by Pix or by transfer.
 */
describe("how incoming money arrived", () => {
  test("Pix when the line says Pix", () => {
    expect(receiptMethodFor("PIX")).toBe("PIX");
  });

  test("a transfer for every card rail the descriptor inferred", () => {
    expect(receiptMethodFor("DEBIT_CARD")).toBe("TRANSFER");
    expect(receiptMethodFor("CREDIT_CARD")).toBe("TRANSFER");
  });

  test("a transfer for a boleto, and for a line that said nothing", () => {
    expect(receiptMethodFor("BOLETO")).toBe("TRANSFER");
    expect(receiptMethodFor(null)).toBe("TRANSFER");
    expect(receiptMethodFor(undefined)).toBe("TRANSFER");
  });

  test("a transfer stays a transfer", () => {
    expect(receiptMethodFor("TRANSFER")).toBe("TRANSFER");
  });
});
