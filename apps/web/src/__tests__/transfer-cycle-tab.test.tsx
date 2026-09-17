/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { TransferCycleTab } from "@/components/transfer-cycle-tab";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/*
 * The report this closes: a first version split transfers into "Saídas" and
 * "Entradas", two benches for one event — and looking at real data made the
 * mistake obvious, since every transfer only ever showed up on one of the two
 * anyway. `transfers` already carries both accounts on its one row; the
 * fixtures here are one fully paired transfer and one where only the source
 * statement has been promoted, which is the ordinary state while the
 * destination statement hasn't been reviewed yet.
 */

const ACCOUNTS = [
  { id: "1", bookId: "2", name: "C6 Conta", type: "ACCOUNT" },
  { id: "2", bookId: "2", name: "Nubank Conta", type: "ACCOUNT" },
];

const TRANSFER_PAIRED = {
  id: "300",
  bookId: "2",
  key: "xfer-88953663307bb6f4c4e1874863efb55a",
  sourceAccountId: "1",
  destinationAccountId: "2",
  referenceMonth: "2026-08-01T00:00:00.000Z",
  amount: "190550",
  currency: "BRL",
};

const TRANSFER_UNPAIRED = {
  id: "301",
  bookId: "2",
  key: "xfer-df2da989484eec58a048dd954eb7c1fe",
  sourceAccountId: "1",
  destinationAccountId: "2",
  referenceMonth: "2026-09-01T00:00:00.000Z",
  amount: "50000",
  currency: "BRL",
};

function movement(over: Record<string, unknown>) {
  return {
    id: "10",
    bookId: "2",
    institutionId: "1",
    accountId: "1",
    source: "c6/conta",
    purchaseDate: "2026-08-20T00:00:00.000Z",
    description: "PIX ENVIADO PARA GELAGOELA BAR E RESTAURANTE",
    descriptorKey: "pix_enviado_para_gelagoela",
    amount: "-190550",
    currency: "BRL",
    status: "POSTED",
    transferId: "300",
    ...over,
  };
}

const OUT_PAIRED = movement({ id: "10" });
const IN_PAIRED = movement({
  id: "11",
  accountId: "2",
  amount: "190550",
  description:
    "TRANSFERÊNCIA RECEBIDA PELO PIX - GELAGOELA BAR E RESTAURANTE LTDA",
});
const OUT_UNPAIRED = movement({
  id: "12",
  amount: "-50000",
  transferId: "301",
  description: "PIX ENVIADO PARA NUTRICAO EM FOCO",
  purchaseDate: "2026-09-01T00:00:00.000Z",
});

function stubApi(opts: { empty?: boolean } = {}) {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    const items = opts.empty
      ? path.includes("/accounts")
        ? ACCOUNTS
        : []
      : path.includes("/movements/account")
        ? [OUT_PAIRED, IN_PAIRED, OUT_UNPAIRED]
        : path.includes("/transfers")
          ? [TRANSFER_PAIRED, TRANSFER_UNPAIRED]
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
  render(<TransferCycleTab bookId="2" />);
  // Both fixtures move money the same way — C6 to Nubank — so the row text
  // is never unique on its own; the list existing is what "loaded" means.
  await waitFor(() =>
    expect(screen.getAllByText("C6 Conta → Nubank Conta").length).toBe(2),
  );
}

describe("one bench, not two", () => {
  test("lists every transfer once, source to destination", async () => {
    stubApi();
    await open();
    expect(screen.getAllByText("C6 Conta → Nubank Conta").length).toBe(2);
    expect(screen.getByText("1,905.50 BRL")).toBeDefined();
    expect(screen.getByText("500.00 BRL")).toBeDefined();
  });

  test("badges whether both sides have been promoted", async () => {
    stubApi();
    await open();
    expect(screen.getByText("Completa")).toBeDefined();
    expect(screen.getByText("Só um lado")).toBeDefined();
  });

  test("says so when there is nothing at all", async () => {
    stubApi({ empty: true });
    render(<TransferCycleTab bookId="2" />);
    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma transferência registrada neste Book."),
      ).toBeDefined(),
    );
  });
});

describe("opening a transfer", () => {
  test("a fully paired one shows both statement lines", async () => {
    stubApi();
    await open();
    const item = screen
      .getByText("PIX ENVIADO PARA GELAGOELA BAR E RESTAURANTE")
      .closest("li") as HTMLElement;
    fireEvent.click(item.querySelector("button") as HTMLElement);

    await waitFor(() =>
      expect(
        within(item).getByText(
          "TRANSFERÊNCIA RECEBIDA PELO PIX - GELAGOELA BAR E RESTAURANTE LTDA",
        ),
      ).toBeDefined(),
    );
    expect(within(item).getByText("C6 Conta")).toBeDefined();
    expect(within(item).getByText("Nubank Conta")).toBeDefined();
  });

  test("a one-sided one shows just the side that has been promoted", async () => {
    stubApi();
    await open();
    const item = screen
      .getByText("PIX ENVIADO PARA NUTRICAO EM FOCO")
      .closest("li") as HTMLElement;
    fireEvent.click(item.querySelector("button") as HTMLElement);

    await waitFor(() =>
      expect(
        within(item).getAllByText("PIX ENVIADO PARA NUTRICAO EM FOCO").length,
      ).toBe(2),
    );
    // No second row, and no "nothing yet" message either — one line is what
    // "only the source has been promoted" looks like.
    expect(within(item).queryAllByRole("row").length).toBe(2); // header + 1
  });
});

/*
 * The other half of "análogo ao expenses": once a transfer has a name — from
 * the descriptor that declared it one — the name leads, the account pair
 * moves to the second line, the same swap `expenses.name` makes over its
 * party · category.
 */
describe("a transfer's name", () => {
  test("leads once it has one, with the account pair as context underneath", async () => {
    globalThis.fetch = (async (url: string) => {
      const path = String(url);
      const items = path.includes("/movements/account")
        ? [OUT_PAIRED, IN_PAIRED]
        : path.includes("/transfers")
          ? [{ ...TRANSFER_PAIRED, name: "Gelagoela Bar" }]
          : path.includes("/accounts")
            ? ACCOUNTS
            : [];
      return new Response(JSON.stringify({ items, nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    render(<TransferCycleTab bookId="2" />);
    await waitFor(() => screen.getByText("Gelagoela Bar"));
    expect(screen.getByText("C6 Conta → Nubank Conta")).toBeDefined();
  });
});
