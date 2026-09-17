/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ReviewTab } from "@/components/review-tab";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/*
 * The report this closes: a descriptor for a Stone card-acquirer deposit had
 * been mapped to Karisma Imóveis — the landlord — instead of Stone. Once a
 * descriptor has a party, a category and a method, it drops out of the
 * pending queue, which is the whole point of that query — but nothing filled
 * the gap it left: there was no screen where an already-wrong mapping could
 * be found and corrected. Mapeados is that screen.
 */

const MAESTRO_KEY = "cred_loj_c_debito_cart._debit_-_stone_pagamento_-_maestro";

const ACCOUNTS = [
  { id: "1", bookId: "2", key: "c6-conta", name: "C6 Conta", type: "ACCOUNT" },
];

const PARTIES = [
  {
    id: "1",
    bookId: "2",
    key: "karisma",
    name: "Karisma Imóveis",
    type: "COMPANY",
  },
  { id: "7", bookId: "2", key: "stone", name: "Stone", type: "COMPANY" },
];

const CATEGORIES = [
  { id: "1", bookId: "2", kind: "EXPENSE", name: "Custos fixos" },
  { id: "3", bookId: "2", kind: "REVENUE", name: "Receitas" },
];

/* Still open — proof the two lists stay exclusive. */
const PENDING_ITEM = {
  id: "7",
  bookId: "2",
  accountId: "1",
  key: "papon_mini_-_mercado_e",
  partyId: null,
  categoryId: null,
  method: null,
  counterAccountId: null,
  movements: 21,
  total: "-48350",
  firstSeen: "2026-04-02T00:00:00.000Z",
  lastSeen: "2026-08-29T00:00:00.000Z",
  sourceCategories: [{ value: "SUPERMERCADO", count: 21 }],
};

const PENDING_RAW = {
  id: "7",
  bookId: "2",
  accountId: "1",
  key: "papon_mini_-_mercado_e",
  partyId: null,
  categoryId: null,
  method: null,
  counterAccountId: null,
};

/* Wrongly mapped: filled, so it dropped off the pending queue, and wrong. */
const MAPPED_RAW = {
  id: "111",
  bookId: "2",
  accountId: "1",
  key: MAESTRO_KEY,
  partyId: "1",
  categoryId: "3",
  method: "TRANSFER",
  counterAccountId: null,
};

function movement(over: Record<string, unknown>) {
  return {
    id: "500",
    bookId: "2",
    institutionId: "1",
    accountId: "1",
    source: "c6/conta",
    purchaseDate: "2026-08-10T00:00:00.000Z",
    description: "CRED LOJ C DEBITO CART. DEBIT - STONE PAGAMENTO - MAESTRO",
    descriptorKey: MAESTRO_KEY,
    amount: "11500",
    currency: "BRL",
    status: "PENDING",
    ...over,
  };
}

const MOVEMENTS = [
  movement({
    id: "501",
    amount: "11500",
    purchaseDate: "2026-08-10T00:00:00.000Z",
  }),
  // A second, already posted — evidence has to count it too: the queue this
  // mirrors joins against every movement, not only what is still unposted.
  movement({
    id: "502",
    amount: "5000",
    purchaseDate: "2026-08-12T00:00:00.000Z",
    status: "POSTED",
  }),
];

function stubApi() {
  const patches: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";

    if (method === "PATCH") {
      patches.push({ url: path, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({ ...MAPPED_RAW, ...JSON.parse(String(init?.body)) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (method !== "GET") {
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const items = path.includes("/account-descriptors/pending")
      ? [PENDING_ITEM]
      : path.includes("/account-descriptors")
        ? [PENDING_RAW, MAPPED_RAW]
        : path.includes("/movements/account")
          ? MOVEMENTS
          : path.includes("/parties")
            ? PARTIES
            : path.includes("/categories")
              ? CATEGORIES
              : path.includes("/accounts")
                ? ACCOUNTS
                : [];
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return patches;
}

async function openMapeados() {
  render(<ReviewTab bookId="2" side="account" />);
  await waitFor(() => screen.getByRole("tab", { name: /Pendentes/ }));
  fireEvent.click(screen.getByRole("tab", { name: /Mapeados/ }));
  await waitFor(() => screen.getByText(MAESTRO_KEY));
}

describe("a descriptor that is already mapped", () => {
  test("is absent from Pendentes", async () => {
    stubApi();
    render(<ReviewTab bookId="2" side="account" />);
    await waitFor(() => screen.getByText("papon_mini_-_mercado_e"));
    expect(screen.queryByText(MAESTRO_KEY)).toBeNull();
  });

  test("appears under Mapeados, with its current party", async () => {
    stubApi();
    await openMapeados();
    expect(screen.getByText("Karisma Imóveis")).toBeDefined();
    // The pending descriptor stays out of this list, the same way round.
    expect(screen.queryByText("papon_mini_-_mercado_e")).toBeNull();
  });

  /*
   * The evidence has to come from the movements, not be invented: this is
   * what makes "17 linhas" on the real descriptor a checkable claim rather
   * than a guess, and it is computed client-side because the pending query
   * drops a mapped descriptor before it ever reaches this evidence.
   */
  test("counts and totals its movements, any status included", async () => {
    stubApi();
    await openMapeados();
    const button = screen.getByText(MAESTRO_KEY).closest("button");
    expect(button?.textContent).toContain("165,00");
  });

  test("opens into a form preselected with the wrong mapping", async () => {
    stubApi();
    await openMapeados();
    fireEvent.click(
      screen.getByText(MAESTRO_KEY).closest("button") as HTMLElement,
    );
    await waitFor(() => screen.getByLabelText("parte"));
    expect((screen.getByLabelText("parte") as HTMLSelectElement).value).toBe(
      "1",
    );
    expect(
      (screen.getByLabelText("categoria") as HTMLSelectElement).value,
    ).toBe("3");
  });

  /* The fix the report asked for: pick Stone, save, and it PATCHes. */
  test("is corrected by choosing another party and saving", async () => {
    const patches = stubApi();
    await openMapeados();
    fireEvent.click(
      screen.getByText(MAESTRO_KEY).closest("button") as HTMLElement,
    );
    await waitFor(() => screen.getByLabelText("parte"));

    fireEvent.change(screen.getByLabelText("parte"), {
      target: { value: "7" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Vale para 2 movimentos/ }),
    );

    await waitFor(() => expect(patches.length).toBe(1));
    expect(patches[0]?.url).toContain("/account-descriptors/111");
    expect(patches[0]?.body).toEqual({
      partyId: "7",
      categoryId: "3",
      method: "TRANSFER",
      name: null,
      counterAccountId: null,
    });
  });
});

describe("when nothing is mapped yet", () => {
  test("says so, distinctly from the pending empty state", async () => {
    globalThis.fetch = (async (url: string) => {
      const path = String(url);
      const items = path.includes("/account-descriptors/pending")
        ? []
        : path.includes("/account-descriptors")
          ? []
          : path.includes("/accounts")
            ? ACCOUNTS
            : [];
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    render(<ReviewTab bookId="2" side="account" />);
    fireEvent.click(
      await waitFor(() => screen.getByRole("tab", { name: /Mapeados/ })),
    );
    await waitFor(() =>
      expect(screen.getByText("Nenhum descritor mapeado ainda.")).toBeDefined(),
    );
  });
});

/*
 * The label reaches the collapsed row too, once it exists — not just the
 * form: it is what the operator sees at a glance, without opening the row
 * again, to tell a named descriptor from one still waiting on a title.
 */
describe("a descriptor's name", () => {
  test("shows on the collapsed row once it has one", async () => {
    globalThis.fetch = (async (url: string) => {
      const path = String(url);
      const items = path.includes("/account-descriptors/pending")
        ? []
        : path.includes("/account-descriptors")
          ? [{ ...MAPPED_RAW, name: "Maquininha Stone" }]
          : path.includes("/movements/account")
            ? MOVEMENTS
            : path.includes("/parties")
              ? PARTIES
              : path.includes("/categories")
                ? CATEGORIES
                : path.includes("/accounts")
                  ? ACCOUNTS
                  : [];
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await openMapeados();
    expect(screen.getByText("Maquininha Stone")).toBeDefined();
  });

  test("can be changed and saved", async () => {
    const patches = stubApi();
    await openMapeados();

    fireEvent.click(
      screen.getByText(MAESTRO_KEY).closest("button") as HTMLElement,
    );
    await waitFor(() => screen.getByLabelText("nome"));
    fireEvent.change(screen.getByLabelText("nome"), {
      target: { value: "Maquininha Stone" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Vale para 2 movimentos/ }),
    );

    await waitFor(() => expect(patches.length).toBe(1));
    expect(
      (patches[0]?.body as { name?: string | null } | undefined)?.name,
    ).toBe("Maquininha Stone");
  });
});
