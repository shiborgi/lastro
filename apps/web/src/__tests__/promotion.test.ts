/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { CatalogRecord, Movement } from "@/lib/api";
import { planPromotion, referenceMonthOf, verdictFor } from "@/lib/promotion";

/*
 * These tests exist to keep one thing true: that this mirror agrees with
 * `postMovement`. Each case below names the refusal the server would produce,
 * so a rule that changes there fails here instead of quietly turning the screen
 * into a list of promises the ledger will not keep.
 */

const CATEGORIES: CatalogRecord[] = [
  { id: "1", bookId: "2", name: "Insumos", kind: "EXPENSE" },
  { id: "3", bookId: "2", name: "Vendas cartão", kind: "REVENUE" },
];

function line(over: Partial<Movement> = {}): Movement {
  return {
    id: "10",
    bookId: "2",
    institutionId: "1",
    accountId: "1",
    source: "c6/conta",
    purchaseDate: "2026-08-29T00:00:00.000Z",
    description: "PAPON MINI - MERCADO E",
    descriptorKey: "papon_mini_-_mercado_e",
    amount: "-4835",
    currency: "BRL",
    status: "PENDING",
    ...over,
  };
}

function descriptor(over: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    id: "7",
    bookId: "2",
    accountId: "1",
    key: "papon_mini_-_mercado_e",
    name: "papon_mini_-_mercado_e",
    partyId: "42",
    categoryId: "1",
    ...over,
  };
}

describe("what the ledger would accept", () => {
  test("money out of an account is an expense", () => {
    expect(verdictFor("account", "-4835", descriptor(), CATEGORIES)).toEqual({
      ready: true,
      becomes: "expense",
    });
  });

  test("money into an account is a revenue", () => {
    expect(
      verdictFor("account", "293904", descriptor({ categoryId: "3" }), [
        ...CATEGORIES,
      ]),
    ).toEqual({ ready: true, becomes: "revenue" });
  });

  test("a card line is an expense whatever else is set", () => {
    expect(verdictFor("card", "434496", descriptor(), CATEGORIES)).toEqual({
      ready: true,
      becomes: "expense",
    });
  });

  /*
   * The order that matters: naming another account decides the line before
   * party and category are looked at, because a transfer needs neither.
   */
  test("a named account makes it a transfer, with no party or category", () => {
    expect(
      verdictFor(
        "account",
        "-190550",
        descriptor({ partyId: null, categoryId: null, counterAccountId: "2" }),
        CATEGORIES,
      ),
    ).toEqual({ ready: true, becomes: "transfer" });
  });
});

describe("what it would refuse, and why", () => {
  test("a credit on an invoice — the bill being paid, not an earning", () => {
    expect(verdictFor("card", "-434496", descriptor(), CATEGORIES)).toEqual({
      ready: false,
      blocker: "card-credit",
    });
  });

  test("no party", () => {
    expect(
      verdictFor("account", "-4835", descriptor({ partyId: null }), CATEGORIES),
    ).toEqual({ ready: false, blocker: "no-party" });
  });

  test("no category", () => {
    expect(
      verdictFor(
        "account",
        "-4835",
        descriptor({ categoryId: null }),
        CATEGORIES,
      ),
    ).toEqual({ ready: false, blocker: "no-category" });
  });

  /*
   * The refusal the review screen used to invite: an inflow mapped to an
   * expense category. `movement is money in but "Insumos" is a EXPENSE
   * category` is the server's wording for it.
   */
  test("an inflow mapped to an expense category", () => {
    expect(verdictFor("account", "293904", descriptor(), CATEGORIES)).toEqual({
      ready: false,
      blocker: "wrong-kind",
    });
  });

  test("an outflow mapped to a revenue category", () => {
    expect(
      verdictFor(
        "account",
        "-4835",
        descriptor({ categoryId: "3" }),
        CATEGORIES,
      ),
    ).toEqual({ ready: false, blocker: "wrong-kind" });
  });

  test("a category that no longer exists", () => {
    expect(
      verdictFor("account", "-4835", descriptor({ categoryId: "99" }), []),
    ).toEqual({ ready: false, blocker: "wrong-kind" });
  });

  test("no descriptor at all", () => {
    expect(verdictFor("account", "-4835", undefined, CATEGORIES)).toEqual({
      ready: false,
      blocker: "no-descriptor",
    });
  });
});

describe("the plan", () => {
  /*
   * The shape of the real bench: one wording covers many lines, and that is
   * the whole reason the screen groups by decision instead of by row.
   */
  test("groups lines under the decision that releases them", () => {
    const plan = planPromotion({
      card: [],
      account: [
        line({ id: "10", amount: "-4835" }),
        line({ id: "11", amount: "-2000" }),
        line({ id: "12", amount: "-1000" }),
      ],
      cardDescriptors: [],
      accountDescriptors: [descriptor()],
      categories: CATEGORIES,
    });

    expect(plan.ready).toHaveLength(1);
    expect(plan.ready[0]?.lines).toHaveLength(3);
    expect(plan.ready[0]?.total).toBe("-7835");
    expect(plan.readyLines).toBe(3);
    expect(plan.blockedLines).toBe(0);
  });

  test("separates the same wording on two accounts", () => {
    const plan = planPromotion({
      card: [],
      account: [line({ id: "10" }), line({ id: "11", accountId: "2" })],
      cardDescriptors: [],
      accountDescriptors: [descriptor(), descriptor({ id: "8" })],
      categories: CATEGORIES,
    });

    // The second account's line finds no descriptor of its own.
    expect(plan.ready).toHaveLength(1);
    expect(plan.blocked).toEqual([
      {
        blocker: "no-descriptor",
        side: "account",
        lines: 1,
        descriptors: 1,
        total: "-4835",
      },
    ]);
  });

  test("orders decisions by how many lines each one releases", () => {
    const plan = planPromotion({
      card: [],
      account: [
        line({ id: "10" }),
        line({ id: "11", descriptorKey: "uber_trip" }),
        line({ id: "12", descriptorKey: "uber_trip" }),
      ],
      cardDescriptors: [],
      accountDescriptors: [
        descriptor(),
        descriptor({ id: "8", key: "uber_trip" }),
      ],
      categories: CATEGORIES,
    });

    expect(plan.ready.map((decision) => decision.descriptorKey)).toEqual([
      "uber_trip",
      "papon_mini_-_mercado_e",
    ]);
  });

  test("counts each reason once, with the lines and wordings behind it", () => {
    const plan = planPromotion({
      card: [],
      account: [
        line({ id: "10" }),
        line({ id: "11", descriptorKey: "uber_trip" }),
        line({ id: "12", descriptorKey: "uber_trip" }),
      ],
      cardDescriptors: [],
      accountDescriptors: [
        descriptor({ partyId: null }),
        descriptor({ id: "8", key: "uber_trip", partyId: null }),
      ],
      categories: CATEGORIES,
    });

    expect(plan.ready).toHaveLength(0);
    expect(plan.blocked).toEqual([
      {
        blocker: "no-party",
        side: "account",
        lines: 3,
        descriptors: 2,
        total: "-14505",
      },
    ]);
  });

  /* A wording can collide across the two statement kinds; they never merge. */
  test("keeps the two sides apart", () => {
    const plan = planPromotion({
      card: [line({ id: "20", amount: "434496" })],
      account: [line({ id: "10" })],
      cardDescriptors: [descriptor({ id: "9" })],
      accountDescriptors: [descriptor()],
      categories: CATEGORIES,
    });

    expect(plan.ready).toHaveLength(2);
    expect(plan.ready.map((decision) => decision.side).sort()).toEqual([
      "account",
      "card",
    ]);
  });

  test("ignores anything already posted or ignored", () => {
    const plan = planPromotion({
      card: [],
      account: [
        line({ id: "10", status: "POSTED" }),
        line({ id: "11", status: "IGNORED" }),
      ],
      cardDescriptors: [],
      accountDescriptors: [descriptor()],
      categories: CATEGORIES,
    });

    expect(plan.readyLines).toBe(0);
    expect(plan.blockedLines).toBe(0);
  });
});

/*
 * The month is the first of the line's own month in UTC. A local-time month
 * would file a purchase made late on the 31st under the following one.
 */
describe("the month a promotion is filed under", () => {
  test("is the first of the line's month", () => {
    expect(referenceMonthOf("2026-08-29T00:00:00.000Z")).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  test("does not shift on the last instant of a month", () => {
    expect(referenceMonthOf("2026-08-31T23:59:59.000Z")).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});
