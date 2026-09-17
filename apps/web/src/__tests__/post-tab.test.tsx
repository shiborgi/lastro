/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { PostTab } from "@/components/post-tab";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/*
 * The interruption this screen closes: eighty-one lines were decided, provable
 * and unposted, sitting in the same queue as the hundred and thirty-five nobody
 * had looked at. There was no way to act on the difference — the dashboard had
 * no promote button at all, and the API route behind one answered 400.
 */

const ACCOUNTS = [
  { id: "1", bookId: "2", key: "c6-conta", name: "C6 Conta", type: "ACCOUNT" },
  {
    id: "2",
    bookId: "2",
    key: "nubank-conta",
    name: "Nubank Conta",
    type: "ACCOUNT",
  },
];

const PARTIES = [
  { id: "42", bookId: "2", key: "papon", name: "Papon Mini", type: "COMPANY" },
];

const CATEGORIES = [
  { id: "1", bookId: "2", name: "Insumos", kind: "EXPENSE" },
  { id: "3", bookId: "2", name: "Vendas cartão", kind: "REVENUE" },
];

const ACCOUNT_DESCRIPTORS = [
  {
    id: "7",
    bookId: "2",
    accountId: "1",
    key: "papon_mini_-_mercado_e",
    name: "papon_mini_-_mercado_e",
    partyId: "42",
    categoryId: "1",
    counterAccountId: null,
  },
  // Mapped to nothing: it is what the blocked half of the screen reports.
  {
    id: "8",
    bookId: "2",
    accountId: "1",
    key: "posto_ipiranga",
    name: "posto_ipiranga",
    partyId: null,
    categoryId: null,
    counterAccountId: null,
  },
  // A named account, which is the declaration that the line is a transfer.
  {
    id: "9",
    bookId: "2",
    accountId: "1",
    key: "pix_enviado_para_gelagoela",
    name: "pix_enviado_para_gelagoela",
    partyId: null,
    categoryId: null,
    counterAccountId: "2",
  },
];

function movement(over: Record<string, unknown> = {}) {
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

const ACCOUNT_MOVEMENTS = [
  movement({ id: "10" }),
  movement({ id: "11", amount: "-2000" }),
  movement({
    id: "12",
    descriptorKey: "posto_ipiranga",
    description: "POSTO IPIRANGA",
    amount: "-15000",
  }),
  movement({
    id: "13",
    descriptorKey: "pix_enviado_para_gelagoela",
    description: "PIX ENVIADO PARA GELAGOELA",
    amount: "-190550",
  }),
];

/** Answers per resource, records every write, and can refuse on demand. */
function stubApi(opts: { refuse?: string; empty?: boolean } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";

    if (method === "POST" && path.includes("/post")) {
      posts.push({ url: path, body: JSON.parse(String(init?.body)) });
      if (opts.refuse && path.includes(`/${opts.refuse}/post`)) {
        return new Response(
          JSON.stringify({
            error: {
              code: "CONFLICT",
              message:
                'movement is money in but "Insumos" is a EXPENSE category',
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          kind: "expense",
          id: "500",
          amount: "4835",
          method: "PIX",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    const items = path.includes("/movements/account")
      ? opts.empty
        ? []
        : ACCOUNT_MOVEMENTS
      : path.includes("/movements/card")
        ? []
        : path.includes("/account-descriptors")
          ? ACCOUNT_DESCRIPTORS
          : path.includes("/card-descriptors")
            ? []
            : path.includes("/categories")
              ? CATEGORIES
              : path.includes("/accounts")
                ? ACCOUNTS
                : path.includes("/parties")
                  ? PARTIES
                  : [];
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return posts;
}

async function openTheScreen() {
  render(<PostTab bookId="2" />);
  await waitFor(() => screen.getByText("Prontos para lançar"));
}

describe("what the screen claims is ready", () => {
  test("counts the lines and the decisions behind them", async () => {
    stubApi();
    await openTheScreen();
    // Three ready lines: two Papon, one transfer. Two decisions.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Lançar 3 linhas" }),
      ).toBeDefined(),
    );
    expect(screen.getByText(/3 linhas em 2 decisões/)).toBeDefined();
  });

  /*
   * The claim has to be checkable, so each row names the mapping it came from
   * and what the line will become — not just that it is ready.
   */
  test("names the mapping and what it becomes", async () => {
    stubApi();
    await openTheScreen();
    await waitFor(() => screen.getByText("Papon Mini · Insumos"));
    expect(screen.getAllByText("despesa").length).toBeGreaterThan(0);
  });

  test("shows a transfer as an account pair, with no party or category", async () => {
    stubApi();
    await openTheScreen();
    await waitFor(() => screen.getByText("C6 Conta → Nubank Conta"));
    expect(screen.getByText("transferência")).toBeDefined();
  });

  /* The lines are there to check the decision before confirming it. */
  test("opens a decision into the lines it covers", async () => {
    stubApi();
    await openTheScreen();
    const toggle = await waitFor(() =>
      screen.getByRole("button", { expanded: false, name: /Papon Mini/ }),
    );
    fireEvent.click(toggle);
    // Both Papon lines fall on the same day, which is why this counts them.
    await waitFor(() =>
      expect(screen.getAllByText("29/08/2026").length).toBe(2),
    );
    // Each line with its own figure, and the group's sum still in the row.
    expect(screen.getByText("−20,00")).toBeDefined();
    expect(screen.getByText("−68,35")).toBeDefined();
  });
});

describe("what it says is not ready", () => {
  test("reports each reason with its lines and wordings", async () => {
    stubApi();
    await openTheScreen();
    await waitFor(() => screen.getByText("Faltam decidir"));
    expect(screen.getByText(/sem parte/)).toBeDefined();
    expect(screen.getByText(/extrato, 1 descritor/)).toBeDefined();
  });

  test("offers the bench that clears it", async () => {
    stubApi();
    const seen: string[] = [];
    render(<PostTab bookId="2" onReview={(side) => seen.push(side)} />);
    await waitFor(() => screen.getByText("Faltam decidir"));
    fireEvent.click(screen.getByRole("button", { name: "Abrir revisão" }));
    expect(seen).toEqual(["account"]);
  });
});

describe("promoting", () => {
  /*
   * One call per line, and the month is the first of the line's own month.
   * `kind` and `id` are in the path, which is the whole reason the body has a
   * contract of its own — sending them made the route answer 400.
   */
  test("posts every ready line, with the month in the body", async () => {
    const posts = stubApi();
    await openTheScreen();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Lançar 3/ })),
    );

    await waitFor(() => expect(posts.length).toBe(3));
    expect(posts[0]?.url).toContain("/v1/books/2/movements/account/10/post");
    expect(posts[0]?.body).toEqual({
      referenceMonth: "2026-08-01T00:00:00.000Z",
    });
  });

  test("promotes one decision on its own", async () => {
    const posts = stubApi();
    await openTheScreen();
    const row = await waitFor(() =>
      screen.getByText("C6 Conta → Nubank Conta").closest("li"),
    );
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Lançar" })
        .find((button) => row?.contains(button)) as HTMLElement,
    );

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]?.url).toContain("/movements/account/13/post");
  });

  test("reports what landed", async () => {
    stubApi();
    await openTheScreen();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Lançar 3/ })),
    );
    await waitFor(() => screen.getByRole("status"));
    expect(screen.getByRole("status").textContent).toContain(
      "3 linhas lançadas",
    );
  });

  /*
   * A refusal is this screen's readiness rule disagreeing with the ledger, so
   * it is shown in the ledger's own words — and the other lines still go.
   */
  test("keeps going past a refusal and quotes it verbatim", async () => {
    const posts = stubApi({ refuse: "11" });
    await openTheScreen();
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: /Lançar 3/ })),
    );

    await waitFor(() => expect(posts.length).toBe(3));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("1 recusada"),
    );
    expect(
      screen.getByText(
        'movement is money in but "Insumos" is a EXPENSE category',
      ),
    ).toBeDefined();
  });
});

describe("when there is nothing to do", () => {
  test("says so instead of showing an empty frame", async () => {
    stubApi({ empty: true });
    render(<PostTab bookId="2" />);
    await waitFor(() => screen.getByText(/Nada aguardando/));
    expect(screen.queryByText("Prontos para lançar")).toBeNull();
  });
});
