/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApplication, databaseRefusal } from "@lastro/application";
import {
  AccountDescriptorResource,
  AccountMovementResource,
  AccountReferenceMonthResource,
  BookInsightsResource,
  CardDescriptorResource,
  CardMovementResource,
  FinancialResource,
  PendingAccountDescriptorResource,
  PendingCardDescriptorResource,
  PostMovement,
  PostMovementBody,
  TransferResource,
  movementResource,
  normalizeResource,
} from "@lastro/contracts";
import type {
  AccountDescriptor,
  AccountMovement,
  AccountReferenceMonth,
  BookInsights,
  CardDescriptor,
  CardMovement,
  Expense,
  PendingAccountDescriptor,
  PendingCardDescriptor,
  Revenue,
  Transfer,
} from "@lastro/domain";

/*
 * The seam TypeScript cannot see.
 *
 * Every resource schema is `.strict()`, and each is checked against a domain
 * type that lives in another package. Nothing compares the two: adding a field
 * to the domain type compiles everywhere and then fails at runtime, inside a
 * `.parse()`, as an unrecognized_keys error the caller sees as a broken screen.
 *
 * That is exactly how the split shipped: `BookInsights.gap` gained four
 * per-side counts, the repository filled them, the web app read them, and the
 * contract in between rejected the whole response.
 *
 * Each case below is typed as the domain type — so TypeScript rejects a value
 * the domain does not allow — and then parsed by the schema, so the schema has
 * to accept every field the domain declares. The two can no longer drift.
 */

const ISO = "2026-09-01T00:00:00.000Z";

describe("a domain value satisfies its own resource schema", () => {
  test("book insights, counts per side included", () => {
    const insights: BookInsights = {
      gap: {
        stagedMovements: 216,
        postedMovements: 1,
        ledgerRecords: 1,
        descriptors: 69,
        descriptorsPending: 68,
        cardDescriptors: 26,
        cardDescriptorsPending: 26,
        accountDescriptors: 43,
        accountDescriptorsPending: 42,
      },
      cash: [
        {
          source: "c6/conta/extrato.csv",
          days: [{ date: new Date(ISO), inflow: 1000n, outflow: 250n }],
        },
      ],
      byGroup: [
        {
          group: "Operação",
          category: "Insumos",
          kind: "EXPENSE",
          total: 4500n,
          count: 3,
        },
      ],
    };

    const parsed = BookInsightsResource.parse({
      gap: insights.gap,
      cash: insights.cash.map((entry) => ({
        source: entry.source,
        days: entry.days.map((day) => ({
          date: day.date.toISOString(),
          inflow: day.inflow.toString(),
          outflow: day.outflow.toString(),
        })),
      })),
      byGroup: insights.byGroup.map((row) => ({
        ...row,
        total: row.total.toString(),
      })),
    });
    expect(parsed.gap.cardDescriptorsPending).toBe(26);
    expect(parsed.gap.accountDescriptorsPending).toBe(42);
  });

  /*
   * The three dates go through `normalizeResource`, which had to learn about
   * the window's two ends — `referenceMonth` it already knew. Without that a
   * Date reached the schema where a string was declared, and the whole
   * response was rejected.
   */
  test("a billing window, dates and all", () => {
    const window: AccountReferenceMonth = {
      id: "1",
      bookId: "2",
      accountId: "3",
      referenceMonth: new Date("2026-09-01T00:00:00.000Z"),
      startDate: new Date("2026-08-04T00:00:00.000Z"),
      endDate: new Date("2026-09-03T00:00:00.000Z"),
      createdAt: new Date(ISO),
    };
    const parsed = AccountReferenceMonthResource.parse(
      normalizeResource(window as unknown as Record<string, unknown>),
    );
    expect(parsed.startDate).toBe("2026-08-04T00:00:00.000Z");
    expect(parsed.endDate).toBe("2026-09-03T00:00:00.000Z");
  });

  test("a card descriptor, which carries no method and no kind", () => {
    const descriptor: CardDescriptor = {
      id: "5",
      bookId: "2",
      accountId: "3",
      key: "papon_mini_-_mercado_e",
      partyId: "7",
      categoryId: "3",
      createdAt: new Date(ISO),
    };
    expect(
      CardDescriptorResource.parse({
        ...descriptor,
        createdAt: descriptor.createdAt?.toISOString(),
      }).key,
    ).toBe("papon_mini_-_mercado_e");
  });

  test("an account descriptor, which carries a method and a destination", () => {
    const descriptor: AccountDescriptor = {
      id: "1",
      bookId: "2",
      accountId: "1",
      key: "t_banco_c6_s.a.",
      partyId: null,
      categoryId: null,
      method: "PIX",
      // Set means transfer: it is the declaration, not a separate flag.
      counterAccountId: "4",
      createdAt: new Date(ISO),
    };
    expect(
      AccountDescriptorResource.parse({
        ...descriptor,
        createdAt: descriptor.createdAt?.toISOString(),
      }).counterAccountId,
    ).toBe("4");
  });

  /*
   * The label a descriptor carries once someone sets one — the field this
   * screen exists to test: nothing seeds it, and it is null until an operator
   * writes one, same as party and category.
   */
  test("a descriptor's name, once someone has set one", () => {
    const descriptor: CardDescriptor = {
      id: "5",
      bookId: "2",
      accountId: "3",
      key: "papon_mini_-_mercado_e",
      partyId: "7",
      categoryId: "3",
      name: "Mercado da esquina",
      createdAt: new Date(ISO),
    };
    expect(
      CardDescriptorResource.parse({
        ...descriptor,
        createdAt: descriptor.createdAt?.toISOString(),
      }).name,
    ).toBe("Mercado da esquina");
  });

  /*
   * What promotion actually does with that label: copies it onto the expense
   * or revenue it creates. `FinancialResource` is shared across every
   * financial record, so the seam here is whether it recognises `name` at
   * all — a payment or a settlement never carries one, an expense or revenue
   * does.
   */
  test("an expense's name, copied from the descriptor that promoted it", () => {
    const expense: Expense = {
      id: "500",
      bookId: "2",
      key: "card-abc123",
      referenceMonth: new Date("2026-09-01T00:00:00.000Z"),
      partyId: "7",
      categoryId: "3",
      name: "Mercado da esquina",
      amount: 48350n,
      currency: "BRL",
      occurredAt: new Date(ISO),
      createdAt: new Date(ISO),
    };
    const parsed = FinancialResource.parse(
      normalizeResource(expense as unknown as Record<string, unknown>),
    );
    expect(parsed.name).toBe("Mercado da esquina");
  });

  test("a revenue left unnamed stays null, not omitted", () => {
    const revenue: Revenue = {
      id: "500",
      bookId: "2",
      key: "recv-1-7-2026-09-08",
      referenceMonth: new Date("2026-09-01T00:00:00.000Z"),
      partyId: "7",
      categoryId: "3",
      name: null,
      amount: 293904n,
      currency: "BRL",
      occurredAt: new Date(ISO),
      createdAt: new Date(ISO),
    };
    const parsed = FinancialResource.parse(
      normalizeResource(revenue as unknown as Record<string, unknown>),
    );
    expect(parsed.name).toBeNull();
  });

  /*
   * The field it replaced: `correlationId` duplicated what `audit_events`
   * already recorded for the write, and nothing reachable from outside the
   * package ever read it back. `name` and `occurredAt` are what a transfer
   * needed instead, the same two fields expenses and revenues already carry.
   */
  test("a transfer's name and the day it actually moved, not correlationId", () => {
    const transfer: Transfer = {
      id: "300",
      bookId: "2",
      key: "xfer-88953663307bb6f4c4e1874863efb55a",
      referenceMonth: new Date("2026-08-01T00:00:00.000Z"),
      sourceAccountId: "1",
      destinationAccountId: "2",
      name: "Gelagoela Bar",
      amount: 190550n,
      currency: "BRL",
      occurredAt: new Date("2026-08-20T00:00:00.000Z"),
      createdAt: new Date(ISO),
    };
    const parsed = TransferResource.parse(
      normalizeResource(transfer as unknown as Record<string, unknown>),
    );
    expect(parsed.name).toBe("Gelagoela Bar");
    expect(parsed.occurredAt).toBe("2026-08-20T00:00:00.000Z");
    expect("correlationId" in parsed).toBe(false);
  });

  test("a pending card descriptor and its evidence", () => {
    const pending: PendingCardDescriptor = {
      id: "5",
      bookId: "2",
      accountId: "3",
      key: "papon_mini_-_mercado_e",
      partyId: null,
      categoryId: null,
      name: null,
      movements: 21,
      total: 44290n,
      firstSeen: new Date(ISO),
      lastSeen: new Date(ISO),
      sourceCategories: [{ value: "Supermercados", count: 21 }],
    };
    expect(
      PendingCardDescriptorResource.parse({
        ...pending,
        total: pending.total.toString(),
        firstSeen: pending.firstSeen?.toISOString() ?? null,
        lastSeen: pending.lastSeen?.toISOString() ?? null,
      }).movements,
    ).toBe(21);
  });

  test("a pending account descriptor and its evidence", () => {
    const pending: PendingAccountDescriptor = {
      id: "1",
      bookId: "2",
      accountId: "1",
      key: "cred_loj_c_debito",
      partyId: null,
      categoryId: null,
      method: "DEBIT_CARD",
      counterAccountId: null,
      name: null,
      movements: 17,
      total: 634445n,
      firstSeen: null,
      lastSeen: null,
      sourceCategories: [],
    };
    expect(
      PendingAccountDescriptorResource.parse({
        ...pending,
        total: pending.total.toString(),
      }).method,
    ).toBe("DEBIT_CARD");
  });

  /*
   * The movements go through `movementResource`, which is the serialiser both
   * transports share — so this also pins the renamed `descriptorKey`.
   */
  test("a staged card movement", () => {
    const movement: CardMovement = {
      id: "1",
      bookId: "2",
      institutionId: "2",
      accountId: "3",
      source: "c6/cartao/fatura.csv",
      key: "abc",
      occurrence: 1,
      purchaseDate: new Date(ISO),
      cardholder: "MARCOS WADA",
      cardNumber: "8520",
      category: "Supermercados",
      title: null,
      description: "PAPON MINI - MERCADO E",
      descriptorKey: "papon_mini_-_mercado_e",
      installmentNumber: null,
      installmentCount: null,
      amount: 1200n,
      currency: "BRL",
      status: "PENDING",
      expenseId: null,
      revenueId: null,
      transferId: null,
      importedAt: new Date(ISO),
    };
    expect(
      CardMovementResource.parse(
        movementResource(movement as unknown as Record<string, unknown>),
      ).descriptorKey,
    ).toBe("papon_mini_-_mercado_e");
  });

  test("a staged account movement", () => {
    const movement: AccountMovement = {
      id: "2",
      bookId: "2",
      institutionId: "2",
      accountId: "1",
      source: "c6/conta/extrato.csv",
      key: "def",
      occurrence: 1,
      purchaseDate: new Date(ISO),
      branch: "1",
      accountNumber: "295076852",
      category: null,
      title: "T",
      description: "BANCO C6 S.A.",
      descriptorKey: "t_banco_c6_s.a.",
      amount: -982729n,
      currency: "BRL",
      status: "PENDING",
      expenseId: null,
      revenueId: null,
      transferId: null,
      importedAt: new Date(ISO),
    };
    expect(
      AccountMovementResource.parse(
        movementResource(movement as unknown as Record<string, unknown>),
      ).amount,
    ).toBe("-982729");
  });
});

/*
 * The other seam a type system cannot see: a rule the *database* enforces.
 *
 * Every trigger in this schema raises a message written for whoever hit it.
 * The ORM wraps all of them in `Failed query: insert into ...`, and for a
 * while that is all a caller saw — the sentence that would have told them what
 * to fix sat one level down the cause chain, unread. These pin the extraction.
 */
describe("a refusal from the database keeps its own words", () => {
  /** How the ORM presents a driver error: wrapped, with the real one below. */
  const wrapped = (code: string, message: string) =>
    Object.assign(new Error('Failed query: insert into "categories" ...'), {
      cause: Object.assign(new Error(message), { code }),
    });

  test("surfaces a check violation, which is what the triggers raise", () => {
    expect(
      databaseRefusal(
        wrapped(
          "23514",
          "categories nest one level: the chosen group is already inside a group",
        ),
      ),
    ).toBe(
      "categories nest one level: the chosen group is already inside a group",
    );
  });

  test("surfaces an exclusion violation too", () => {
    expect(databaseRefusal(wrapped("23P01", "window overlaps"))).toBe(
      "window overlaps",
    );
  });

  /*
   * A foreign-key failure means "this row is still referenced", which already
   * has its own handling and its own status. Claiming it here would relabel a
   * 409 nobody asked to change.
   */
  test("leaves other states alone", () => {
    expect(
      databaseRefusal(wrapped("23503", "still referenced")),
    ).toBeUndefined();
    expect(databaseRefusal(wrapped("23505", "duplicate key"))).toBeUndefined();
    expect(databaseRefusal(new Error("something else"))).toBeUndefined();
  });
});

/*
 * The third seam, and the one that bit hardest: a catalog registration hands
 * the parsed request body straight to the command and casts it. So a `Date`
 * field actually receives the ISO string the transport sent, and the cast
 * means neither compiler notices — the first sign was a 400 from the browser
 * reading `input.referenceMonth.toISOString is not a function`.
 *
 * These call the application the way a transport does: with strings.
 */
describe("a catalog command takes the dates a transport sends", () => {
  const written: Record<string, unknown>[] = [];
  const app = createApplication({
    createAccountReferenceMonth: async (input) => {
      written.push({ ...input });
      return { id: "1", ...input } as never;
    },
  } as never);
  const context = {
    actorId: "u",
    bookId: "1",
    role: "OWNER" as const,
    source: "API" as const,
    correlationId: "c",
  };

  test("accepts ISO strings and stores Dates", async () => {
    await app.createAccountReferenceMonth({
      context,
      accountId: "3",
      referenceMonth: "2026-09-01T00:00:00.000Z",
      startDate: "2026-08-04T00:00:00.000Z",
      endDate: "2026-09-03T00:00:00.000Z",
    });
    expect(written[0]?.referenceMonth).toBeInstanceOf(Date);
    expect((written[0]?.startDate as Date).toISOString()).toBe(
      "2026-08-04T00:00:00.000Z",
    );
  });

  test("refuses a string that is not a date, naming the field", async () => {
    await expect(
      app.createAccountReferenceMonth({
        context,
        accountId: "3",
        referenceMonth: "setembro",
        startDate: "2026-08-04T00:00:00.000Z",
        endDate: "2026-09-03T00:00:00.000Z",
      }),
    ).rejects.toThrow('referenceMonth is not a date: "setembro"');
  });
});

/*
 * The third instance of one seam: a contract parsing something it was not
 * shaped for, where the compiler cannot see the mismatch because `safeParse`
 * takes `unknown`.
 *
 * Here the REST route validated the request *body* with `PostMovement`, whose
 * `kind` and `id` are path parameters — so every promotion a browser could send
 * came back 400 naming two fields it had no way to include. It went unnoticed
 * because no screen had a promote button yet.
 */
describe("the promote body, as a browser sends it", () => {
  const sent = { referenceMonth: "2026-09-01T00:00:00.000Z" };

  test("is accepted", () => {
    expect(PostMovementBody.safeParse(sent).success).toBe(true);
  });

  test("was refused by the tool contract, which is why this one exists", () => {
    const parsed = PostMovement.safeParse(sent);
    expect(parsed.success).toBe(false);
    expect(
      parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]),
    ).toEqual(["kind", "id"]);
  });

  /* Still strict: a month that is not a date must refuse, never default. */
  test("refuses a month that is not a date", () => {
    expect(
      PostMovementBody.safeParse({ referenceMonth: "setembro" }).success,
    ).toBe(false);
  });

  /* And the tool contract keeps taking all three, since there it is the input. */
  test("leaves the tool contract alone", () => {
    expect(
      PostMovement.safeParse({ kind: "card", id: "7", ...sent }).success,
    ).toBe(true);
  });
});
