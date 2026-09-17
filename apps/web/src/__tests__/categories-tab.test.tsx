/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { CategoriesTab } from "@/components/categories-tab";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import axe from "axe-core";

/* The Book's real chart of accounts: three groups, four leaves. */
const CATEGORIES = [
  { id: "1", bookId: "2", kind: "EXPENSE", name: "Custos fixos" },
  { id: "2", bookId: "2", kind: "EXPENSE", name: "Custos variáveis" },
  { id: "3", bookId: "2", kind: "REVENUE", name: "Receitas" },
  { id: "4", bookId: "2", kind: "EXPENSE", name: "Aluguel", parentId: "1" },
  {
    id: "5",
    bookId: "2",
    kind: "EXPENSE",
    name: "Telecomunicações",
    parentId: "1",
  },
  { id: "6", bookId: "2", kind: "EXPENSE", name: "Insumos", parentId: "2" },
  {
    id: "7",
    bookId: "2",
    kind: "REVENUE",
    name: "Vendas cartão",
    parentId: "3",
  },
];

/* One posted record, on Aluguel — as the Book actually has it. */
const INSIGHTS = {
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
  cash: [],
  byGroup: [
    {
      group: "Custos fixos",
      category: "Aluguel",
      kind: "EXPENSE",
      total: "-250000",
      count: 1,
    },
  ],
};

function stubApi(extra: { standalone?: boolean } = {}) {
  const sent: { method: string; body: unknown }[] = [];
  const rows = extra.standalone
    ? [
        ...CATEGORIES,
        { id: "8", bookId: "2", kind: "EXPENSE", name: "Impostos" },
      ]
    : CATEGORIES;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = String(url).includes("/insights") ? INSIGHTS : { items: rows };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return sent;
}

describe("the chart of accounts as a tree", () => {
  test("puts each category under the group that holds it", async () => {
    stubApi();
    render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Custos fixos"));

    /*
     * The nesting has to be structural, not a column that names a parent —
     * that is the whole point of the screen. Asserted through the DOM: the
     * group's block must contain its own children and not another group's.
     */
    const group = screen.getByText("Custos fixos").closest("div.rounded-md");
    expect(group?.textContent).toContain("Aluguel");
    expect(group?.textContent).toContain("Telecomunicações");
    expect(group?.textContent).not.toContain("Insumos");
  });

  test("counts the children, since being a group is not a stored flag", async () => {
    stubApi();
    render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Custos fixos"));

    expect(screen.getByText("grupo · 2 categorias")).toBeDefined();
    // Custos variáveis and Receitas both hold exactly one.
    expect(screen.getAllByText("grupo · 1 categoria")).toHaveLength(2);
  });

  test("separates expense from revenue, which never share a branch", async () => {
    stubApi();
    render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Receitas"));

    const revenue = screen.getByText("Receitas").closest("div.rounded-md");
    expect(revenue?.textContent).toContain("Vendas cartão");
    expect(revenue?.textContent).not.toContain("Aluguel");
  });

  test("shows how many records a leaf holds, and nothing where it holds none", async () => {
    stubApi();
    render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Aluguel"));

    expect(screen.getByText("1 lançamento")).toBeDefined();
    // Telecomunicações, Insumos, Vendas cartão: three leaves with no records.
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  /*
   * The rule the screen exists to make legible: nesting under a category turns
   * it into a group, and a group holds no records. So the offer appears on an
   * empty standalone category and is replaced by the reason on a used one.
   */
  test("offers nesting on a standalone category that holds nothing", async () => {
    stubApi({ standalone: true });
    render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Impostos"));

    expect(
      screen.getByRole("button", { name: "Aninhar uma categoria aqui" }),
    ).toBeDefined();
  });

  test("a child is created with its parent's kind, never asked for", async () => {
    const sent = stubApi();
    render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Receitas"));

    // The revenue group's own "add" control, not the expense one.
    const revenue = screen.getByText("Receitas").closest("div.rounded-md");
    fireEvent.click(
      within(revenue as HTMLElement).getByRole("button", {
        name: "Adicionar categoria",
      }),
    );

    fireEvent.change(screen.getByLabelText("Nome da categoria em Receitas"), {
      target: { value: "Vendas Pix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.body).toEqual({
      name: "Vendas Pix",
      kind: "REVENUE",
      parentId: "3",
    });
  });

  test("has no serious accessibility violations, contrast included", async () => {
    stubApi();
    const { container } = render(<CategoriesTab bookId="2" />);
    await waitFor(() => screen.getByText("Custos fixos"));

    const results = await axe.run(container);
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
});
