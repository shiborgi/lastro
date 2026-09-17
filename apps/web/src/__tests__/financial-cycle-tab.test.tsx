/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ExpenseCycleTab,
  RevenueCycleTab,
} from "@/components/financial-cycle-tab";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/*
 * The gap this closes: Despesas, Pagamentos and Liquidações de despesa used
 * to be three flat tables, and a settlement named an expenseId and a
 * paymentId that meant nothing without cross-referencing the other two by
 * hand. Here the settlement never stands alone — it opens out of whichever
 * side you asked about.
 *
 * The fixtures are the financed-purchase case this exists for: one card
 * expense billed across two monthly invoices, so opening it has to list two
 * different payments, and opening either payment has to list this expense
 * back.
 */

const PARTIES = [{ id: "7", bookId: "2", name: "Assai Atacadista" }];
const CATEGORIES = [{ id: "3", bookId: "2", name: "Insumos" }];
const ACCOUNTS = [{ id: "1", bookId: "2", name: "C6 Cartão" }];

const EXPENSE = {
  id: "500",
  bookId: "2",
  key: "card-abc123",
  referenceMonth: "2026-08-01T00:00:00.000Z",
  partyId: "7",
  categoryId: "3",
  name: "Compra em 2x",
  amount: "20000",
  currency: "BRL",
  occurredAt: "2026-08-20T00:00:00.000Z",
};

const EXPENSE_UNSETTLED = {
  id: "501",
  bookId: "2",
  key: "card-def456",
  referenceMonth: "2026-08-01T00:00:00.000Z",
  partyId: "7",
  categoryId: "3",
  name: null,
  amount: "5000",
  currency: "BRL",
};

const PAYMENT_AUG = {
  id: "90",
  bookId: "2",
  accountId: "1",
  key: "card-1-2026-08",
  referenceMonth: "2026-08-01T00:00:00.000Z",
  amount: "10000",
  currency: "BRL",
  dueAt: "2026-08-15T00:00:00.000Z",
  paidAt: "2026-08-15T00:00:00.000Z",
};

const PAYMENT_SEP = {
  id: "91",
  bookId: "2",
  accountId: "1",
  key: "card-1-2026-09",
  referenceMonth: "2026-09-01T00:00:00.000Z",
  amount: "10000",
  currency: "BRL",
  dueAt: "2026-09-15T00:00:00.000Z",
  paidAt: null,
};

const SETTLEMENT_1 = {
  id: "1000",
  bookId: "2",
  expenseId: "500",
  paymentId: "90",
  amount: "10000",
  currency: "BRL",
  installmentNumber: 1,
  installmentCount: 2,
  voidedAt: null,
};

const SETTLEMENT_2 = {
  id: "1001",
  bookId: "2",
  expenseId: "500",
  paymentId: "91",
  amount: "10000",
  currency: "BRL",
  installmentNumber: 2,
  installmentCount: 2,
  voidedAt: "2026-09-10T00:00:00.000Z",
};

function stubApi(opts: { empty?: boolean } = {}) {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    const items = opts.empty
      ? []
      : path.includes("/expense-settlements")
        ? [SETTLEMENT_1, SETTLEMENT_2]
        : path.includes("/expenses")
          ? [EXPENSE, EXPENSE_UNSETTLED]
          : path.includes("/payments")
            ? [PAYMENT_AUG, PAYMENT_SEP]
            : path.includes("/parties")
              ? PARTIES
              : path.includes("/categories")
                ? CATEGORIES
                : path.includes("/accounts")
                  ? ACCOUNTS
                  : [];
    return new Response(JSON.stringify({ items, nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function open() {
  render(<ExpenseCycleTab bookId="2" />);
  await waitFor(() => screen.getByText("Despesas"));
}

describe("the two benches", () => {
  test("lists expenses and payments with how many settlements link them", async () => {
    stubApi();
    await open();
    expect(screen.getByText("Compra em 2x")).toBeDefined();
    expect(screen.getByText("2 pagamentos")).toBeDefined();
    // The unsettled expense reads its own key, since it has no name yet.
    expect(screen.getByText("card-def456")).toBeDefined();
    expect(screen.getByText("0 pagamentos")).toBeDefined();

    expect(screen.getAllByText(/card-1-2026/).length).toBe(2);
    expect(screen.getAllByText("1 despesa").length).toBe(2);
  });

  /*
   * `referenceMonth` says which invoice the debt was billed on — the day the
   * purchase actually happened is a different fact, and the two can land in
   * different months for a financed purchase (see `card-schedule.ts`).
   */
  test("shows when each expense actually happened, not just its invoice month", async () => {
    stubApi();
    await open();
    expect(screen.getByText("2026-08-20")).toBeDefined();
  });

  test("says so when there is nothing at all", async () => {
    stubApi({ empty: true });
    await open();
    expect(
      screen.getByText("Nenhuma despesa registrada neste Book."),
    ).toBeDefined();
    expect(
      screen.getByText("Nenhum pagamento registrado neste Book."),
    ).toBeDefined();
  });
});

describe("opening an expense", () => {
  test("lists every payment it is billed on, one row per installment", async () => {
    stubApi();
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Compra em 2x/ }));

    await waitFor(() => screen.getByText("1/2"));
    expect(screen.getByText("2/2")).toBeDefined();
    // Each installment names the account and the month of its own invoice —
    // the whole point being that the two are different.
    expect(screen.getByText("C6 Cartão · 2026-08-01")).toBeDefined();
    expect(screen.getByText("C6 Cartão · 2026-09-01")).toBeDefined();
    expect(screen.getByText("Ativa")).toBeDefined();
    expect(screen.getByText("Anulada")).toBeDefined();
  });

  test("says so when nothing is settled against it yet", async () => {
    stubApi();
    await open();
    fireEvent.click(screen.getByRole("button", { name: /card-def456/ }));

    await waitFor(() =>
      expect(
        screen.getByText("Nenhum pagamento ligado a esta despesa ainda."),
      ).toBeDefined(),
    );
  });
});

describe("opening a payment", () => {
  test("names the expense it discharges, with party and category", async () => {
    stubApi();
    await open();
    const item = screen
      .getByText("card-1-2026-08")
      .closest("li") as HTMLElement;
    fireEvent.click(item.querySelector("button") as HTMLElement);

    // "Compra em 2x" also names the expense's own row in Despesas above —
    // scoped to this payment's own <li> is what proves the join, not a
    // coincidence of the same text appearing twice on the page.
    await waitFor(() =>
      expect(within(item).getByText("Compra em 2x")).toBeDefined(),
    );
    expect(within(item).getByText("Assai Atacadista · Insumos")).toBeDefined();
  });

  /*
   * A payment's settlements list which expenses it discharges, but not when
   * each one actually happened — the party and the amount say what and how
   * much, not which of several similar trips this one was.
   */
  test("shows when the expense it discharges happened", async () => {
    stubApi();
    await open();
    const item = screen
      .getByText("card-1-2026-08")
      .closest("li") as HTMLElement;
    fireEvent.click(item.querySelector("button") as HTMLElement);

    await waitFor(() =>
      expect(within(item).getByText("2026-08-20")).toBeDefined(),
    );
  });

  test("shows whether it has been paid", async () => {
    stubApi();
    await open();
    expect(screen.getByText("Pago em 2026-08-15")).toBeDefined();
    expect(screen.getByText("Pendente")).toBeDefined();
  });
});

/*
 * The revenue side of the same shape, and the one place it genuinely
 * differs: a day's deposit has no instalment schedule, only the descriptor
 * that says which flag each part of it came from — so the settlement's own
 * column reads a description here, never a fraction.
 *
 * The fixtures are the acquirer case this exists for: one receipt is one
 * day's deposit, fed by several revenue lines, one per card flag.
 */
const REVENUE_MAESTRO = {
  id: "700",
  bookId: "2",
  key: "recv-line-maestro",
  referenceMonth: "2026-09-01T00:00:00.000Z",
  partyId: "7",
  categoryId: "3",
  name: "Vendas Stone",
  amount: "11500",
  currency: "BRL",
  occurredAt: "2026-09-08T00:00:00.000Z",
};

const REVENUE_UNSETTLED = {
  id: "701",
  bookId: "2",
  key: "recv-line-unsettled",
  referenceMonth: "2026-09-01T00:00:00.000Z",
  partyId: "7",
  categoryId: "3",
  name: null,
  amount: "3000",
  currency: "BRL",
};

const RECEIPT_DAY = {
  id: "90",
  bookId: "2",
  accountId: "1",
  key: "recv-1-7-2026-09-08",
  referenceMonth: "2026-09-01T00:00:00.000Z",
  amount: "16500",
  currency: "BRL",
  dueAt: "2026-09-08T00:00:00.000Z",
  paidAt: "2026-09-08T00:00:00.000Z",
};

const REVENUE_SETTLEMENT = {
  id: "2000",
  bookId: "2",
  revenueId: "700",
  receiptId: "90",
  amount: "11500",
  currency: "BRL",
  description: "cred_loj_c_debito_cart._debit_-_stone_pagamento_-_maestro",
  voidedAt: null,
};

function stubRevenueApi(opts: { empty?: boolean } = {}) {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    const items = opts.empty
      ? []
      : path.includes("/revenue-settlements")
        ? [REVENUE_SETTLEMENT]
        : path.includes("/revenues")
          ? [REVENUE_MAESTRO, REVENUE_UNSETTLED]
          : path.includes("/receipts")
            ? [RECEIPT_DAY]
            : path.includes("/parties")
              ? PARTIES
              : path.includes("/categories")
                ? CATEGORIES
                : path.includes("/accounts")
                  ? ACCOUNTS
                  : [];
    return new Response(JSON.stringify({ items, nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function openRevenue() {
  render(<RevenueCycleTab bookId="2" />);
  await waitFor(() => screen.getByText("Receitas"));
}

describe("the revenue cycle", () => {
  test("lists revenues and recebimentos with how many settlements link them", async () => {
    stubRevenueApi();
    await openRevenue();
    expect(screen.getByText("Vendas Stone")).toBeDefined();
    expect(screen.getByText("1 recebimento")).toBeDefined();
    expect(screen.getByText("recv-line-unsettled")).toBeDefined();
    expect(screen.getByText("0 recebimentos")).toBeDefined();
    expect(screen.getByText("1 receita")).toBeDefined();
  });

  /*
   * Same fact as `expenses.occurredAt`, the same reason: the reference month
   * says which cycle the revenue was booked in, not the day the money it
   * names was actually received.
   */
  test("shows when each revenue was actually received", async () => {
    stubRevenueApi();
    await openRevenue();
    expect(screen.getByText("2026-09-08")).toBeDefined();
  });

  test("opening a revenue names the description, not an instalment", async () => {
    stubRevenueApi();
    await openRevenue();
    fireEvent.click(screen.getByRole("button", { name: /Vendas Stone/ }));

    await waitFor(() => screen.getByText("Descrição"));
    expect(
      screen.getByText(
        "cred_loj_c_debito_cart._debit_-_stone_pagamento_-_maestro",
      ),
    ).toBeDefined();
    // The column that would have read "1/2" on the expense side.
    expect(screen.queryByText("Parcela")).toBeNull();
  });

  test("opening a receipt names every revenue line that fed it", async () => {
    stubRevenueApi();
    await openRevenue();
    const item = screen
      .getByText("recv-1-7-2026-09-08")
      .closest("li") as HTMLElement;
    fireEvent.click(item.querySelector("button") as HTMLElement);

    await waitFor(() =>
      expect(within(item).getByText("Vendas Stone")).toBeDefined(),
    );
    expect(within(item).getByText("Assai Atacadista · Insumos")).toBeDefined();
  });

  test("says so when nothing is settled against a revenue yet", async () => {
    stubRevenueApi();
    await openRevenue();
    fireEvent.click(
      screen.getByRole("button", { name: /recv-line-unsettled/ }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("Nenhum recebimento ligado a esta receita ainda."),
      ).toBeDefined(),
    );
  });
});
