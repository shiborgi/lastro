/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ReviewTab } from "@/components/review-tab";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const ALIAS = {
  id: "7",
  bookId: "2",
  accountId: "1",
  key: "papon_mini_-_mercado_e",
  partyId: null,
  categoryId: null,
  method: "DEBIT_CARD",
  counterAccountId: null,
  movements: 21,
  total: "-48350",
  firstSeen: "2026-04-02T00:00:00.000Z",
  lastSeen: "2026-08-29T00:00:00.000Z",
  sourceCategories: [{ value: "SUPERMERCADO", count: 21 }],
};

/*
 * Two expense groups and one revenue group, so the filtering by kind has
 * something to filter.
 */
/* Two accounts, because the account bench mixes them in one queue. */
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

const CATEGORIES = [
  { id: "1", bookId: "2", kind: "EXPENSE", name: "Custos fixos" },
  { id: "2", bookId: "2", kind: "EXPENSE", name: "Custos variáveis" },
  { id: "3", bookId: "2", kind: "REVENUE", name: "Receitas" },
];

/**
 * Answers per resource and records every write, so the test can say what the
 * screen actually sent rather than that it did not throw.
 */
function stubApi(opts: { inflow?: boolean } = {}) {
  const sent: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";

    if (method === "POST" && path.includes("/categories")) {
      sent.push({ url: path, method, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          id: "88",
          bookId: "2",
          kind: "EXPENSE",
          name: "Mercado",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (method === "POST" && path.includes("/parties")) {
      sent.push({ url: path, method, body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          id: "42",
          bookId: "2",
          key: "papon-mini-mercado-e",
          name: "Papon Mini Mercado E",
          type: "COMPANY",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (method !== "GET") {
      sent.push({ url: path, method, body: JSON.parse(String(init?.body)) });
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const items = path.includes("/account-descriptors/pending")
      ? [opts.inflow ? { ...ALIAS, total: "634445" } : ALIAS]
      : path.includes("/parties")
        ? [
            {
              id: "42",
              bookId: "2",
              key: "stone",
              name: "Stone",
              type: "COMPANY",
            },
          ]
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
  return sent;
}

async function openTheRow() {
  render(<ReviewTab bookId="2" side="account" />);
  await waitFor(() => screen.getByText("papon_mini_-_mercado_e"));
  fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]);
  await waitFor(() => screen.getByRole("button", { name: "Criar parte" }));
}

/*
 * The interruption this closes: a descriptor names a shop the books have never
 * seen, and choosing its party means leaving the queue for Cadastro and finding
 * your place again among sixty-nine decisions.
 */
describe("creating a party from the review queue", () => {
  test("seeds the name from what the statement printed", async () => {
    stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar parte" }));

    expect(
      (screen.getByLabelText("Nome da parte") as HTMLInputElement).value,
    ).toBe("Papon Mini Mercado E");
  });

  test("derives the key from the name, so there is nothing to type", async () => {
    stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar parte" }));
    fireEvent.change(screen.getByLabelText("Nome da parte"), {
      target: { value: "Padaria São José" },
    });

    expect(screen.getByText("padaria-sao-jose")).toBeDefined();
  });

  test("creates the party with a type, and selects it on the descriptor", async () => {
    const sent = stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar parte" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.body).toEqual({
      key: "papon-mini-mercado-e",
      name: "Papon Mini Mercado E",
      type: "COMPANY",
    });

    // The point of creating it here: it comes back selected, not just created.
    await waitFor(() =>
      expect((screen.getByLabelText("parte") as HTMLSelectElement).value).toBe(
        "42",
      ),
    );
  });

  test("refuses an empty name instead of posting one", async () => {
    const sent = stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar parte" }));
    fireEvent.change(screen.getByLabelText("Nome da parte"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    expect(screen.getByRole("alert").textContent).toContain("nome");
    expect(sent.length).toBe(0);
  });

  test("shows a rejected creation where it happened, keeping the queue in place", async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      if ((init?.method ?? "GET") === "POST") {
        return new Response(
          JSON.stringify({
            error: { code: "CONFLICT", message: "key already exists" },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          items: path.includes("/account-descriptors/pending") ? [ALIAS] : [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar parte" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "key already exists",
      ),
    );
    // Still on the queue, with the row open — the descriptor's key is printed
    // both in the row and in the panel below it, hence getAllByText.
    expect(screen.getAllByText("papon_mini_-_mercado_e").length).toBe(2);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDefined();
  });
});

/*
 * The same interruption on the other field, with one difference that matters:
 * the name is not seeded. A descriptor's key is what the bank printed about the
 * counterparty, so reading it is reading the file — the bank's *category* is a
 * classification, and adopting it is what this screen exists to refuse.
 */
describe("creating a category from the review queue", () => {
  test("starts empty, never seeded from the bank's own classification", async () => {
    stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));

    const field = screen.getByLabelText(
      "Nome da categoria",
    ) as HTMLInputElement;
    expect(field.value).toBe("");
    // The hint is still on screen, as evidence rather than as an answer.
    expect(screen.getAllByText("SUPERMERCADO").length).toBeGreaterThan(0);
  });

  /*
   * The descriptor totals -483.50: money out, so an expense. Offering REVENUE
   * here would offer the one kind the promotion refuses.
   */
  test("takes the kind from the direction of the money", async () => {
    const sent = stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    expect(screen.getByText("Categoria de despesa")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Nome da categoria"), {
      target: { value: "Mercado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.body).toEqual({ name: "Mercado", kind: "EXPENSE" });
  });

  /*
   * The mirror of the case above, and the one that shows the rule is read from
   * the data rather than hardcoded: an inflow wants a REVENUE category, and
   * only revenue groups can hold it.
   */
  test("takes REVENUE when the money came in", async () => {
    const sent = stubApi({ inflow: true });
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    expect(screen.getByText("Categoria de receita")).toBeDefined();

    const groups = Array.from(
      (screen.getByLabelText("Grupo da categoria") as HTMLSelectElement)
        .options,
    ).map((option) => option.textContent);
    expect(groups).toEqual(["nenhum grupo", "Receitas"]);

    fireEvent.change(screen.getByLabelText("Nome da categoria"), {
      target: { value: "Vendas Pix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.body).toEqual({ name: "Vendas Pix", kind: "REVENUE" });
  });

  test("offers only groups of that kind as a parent", async () => {
    stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));

    const labels = Array.from(
      (screen.getByLabelText("Grupo da categoria") as HTMLSelectElement)
        .options,
    ).map((option) => option.textContent);
    expect(labels).toEqual([
      "nenhum grupo",
      "Custos fixos",
      "Custos variáveis",
    ]);
  });

  test("nests it when a group is chosen, and selects it on the descriptor", async () => {
    const sent = stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    fireEvent.change(screen.getByLabelText("Nome da categoria"), {
      target: { value: "Mercado" },
    });
    fireEvent.change(screen.getByLabelText("Grupo da categoria"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.body).toEqual({
      name: "Mercado",
      kind: "EXPENSE",
      parentId: "2",
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("categoria") as HTMLSelectElement).value,
      ).toBe("88"),
    );
  });

  test("refuses an empty name instead of posting one", async () => {
    const sent = stubApi();
    await openTheRow();
    fireEvent.click(screen.getByRole("button", { name: "Criar categoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    expect(screen.getByRole("alert").textContent).toContain("nome");
    expect(sent.length).toBe(0);
  });
});

/*
 * The queue mixes accounts — the C6 statement and the Nubank one land in the
 * same bench — so a row that does not say where it happened leaves the
 * destination of a transfer to guesswork. The Gelagoela wording exists on both
 * accounts and points opposite ways on each.
 */
describe("the source account on a review row", () => {
  test("names the account the line came from", async () => {
    stubApi();
    await openTheRow();
    expect(screen.getByText("C6 Conta")).toBeDefined();
  });

  /*
   * The direction, read from the sign. Getting it backwards is the mistake
   * this field invites, and the label is what stops it: money out leaves this
   * account, money in arrived in it.
   */
  test("asks for a destination when the money went out", async () => {
    stubApi();
    await openTheRow();
    expect(screen.getByText("foi para outra conta minha")).toBeDefined();
  });

  test("asks for an origin when the money came in", async () => {
    stubApi({ inflow: true });
    await openTheRow();
    expect(screen.getByText("veio de outra conta minha")).toBeDefined();
  });

  test("never offers the line's own account as the other side", async () => {
    stubApi();
    await openTheRow();
    const options = Array.from(
      (screen.getByLabelText(/outra conta minha/) as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(["— não é", "Nubank Conta"]);
  });
});

/*
 * The report this pins: "the statement only maps outflows, you cannot map an
 * inflow". An inflow row has to offer the same three fields and send the same
 * shape — the only thing the sign changes is which way the transfer select
 * reads.
 */
describe("mapping an inflow", () => {
  /*
   * The report that produced this: "as categorias aparecem como despesa". The
   * select listed the whole plan, and three of the four leaves in the real Book
   * are expense — so mapping an inflow meant picking a category promotion would
   * refuse ("movement is money in but Insumos is a EXPENSE category"), and
   * finding out a screen later.
   */
  test("offers only revenue categories", async () => {
    stubApi({ inflow: true });
    await openTheRow();
    const options = Array.from(
      (screen.getByLabelText("categoria") as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(["—", "Receitas"]);
  });

  test("and only expense categories when the money went out", async () => {
    stubApi();
    await openTheRow();
    const options = Array.from(
      (screen.getByLabelText("categoria") as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(["—", "Custos fixos", "Custos variáveis"]);
  });

  test("offers party, category and method, and saves them", async () => {
    const sent = stubApi({ inflow: true });
    await openTheRow();

    fireEvent.change(screen.getByLabelText("parte"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("categoria"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("método"), {
      target: { value: "TRANSFER" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Vale para/ }));

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const patch = sent.find((s) => s.method === "PATCH");
    expect(patch?.body).toEqual({
      partyId: "42",
      categoryId: "3",
      method: "TRANSFER",
      counterAccountId: null,
      name: null,
    });
  });
});

/*
 * What the descriptor's name promotes to: the label the expense or revenue
 * this queue eventually creates will carry. Never seeded — the placeholder
 * suggests the humanized key, but nothing applies it until someone types.
 */
describe("naming the descriptor", () => {
  test("starts empty, with the humanized key as a placeholder only", async () => {
    stubApi();
    await openTheRow();
    const field = screen.getByLabelText("nome") as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("Papon Mini Mercado E");
  });

  test("hides alongside party and category once a transfer is named", async () => {
    stubApi();
    await openTheRow();
    fireEvent.change(screen.getByLabelText(/outra conta minha/), {
      target: { value: "2" },
    });
    expect(screen.getByLabelText("nome").closest("label")).toHaveProperty(
      "hidden",
      true,
    );
  });

  test("is sent trimmed, and null when left blank", async () => {
    const sent = stubApi();
    await openTheRow();
    fireEvent.change(screen.getByLabelText("parte"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("categoria"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("nome"), {
      target: { value: "  Feira da esquina  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Vale para/ }));

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const patch = sent.find((s) => s.method === "PATCH");
    expect((patch?.body as { name?: string | null } | undefined)?.name).toBe(
      "Feira da esquina",
    );
  });
});
