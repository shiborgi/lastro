/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { DailyCloseScreen } from "@/modules/close/daily-closes";
import { PRODUCTS } from "@/modules/sales/catalogs";
import { SalesDaysScreen } from "@/modules/sales/sales-days";
import { ResourceScreen } from "@/shell/resource-screen";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

type Sent = { method: string; path: string; body: unknown; key: string | null };

/* A fake API routed by method and path; it records every write. */
function api(
  reads: Record<string, unknown>,
  answers: Record<string, unknown> = {},
) {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url, "http://localhost").pathname.replace(
      "/api/backend/v1/books/1",
      "",
    );
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (method === "GET") return json(reads[path] ?? { items: [] });
    sent.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    return json(answers[`${method} ${path}`] ?? {});
  }) as unknown as typeof fetch;
  return sent;
}

const beer = {
  id: "3",
  bookId: "1",
  key: "beer",
  name: "Cerveja",
  productCategoryId: "1",
  costOverride: null,
  active: true,
};

describe("products", () => {
  test("the unit cost is typed in reais and sent in centavos", async () => {
    const sent = api({
      "/products": { items: [beer] },
      "/product-categories": {
        items: [
          {
            id: "1",
            bookId: "1",
            key: "drinks",
            name: "Bebidas",
            parentId: null,
          },
        ],
      },
    });
    render(<ResourceScreen bookId="1" spec={PRODUCTS} />);
    // The required category select needs its choices, or the form will not submit.
    await screen.findByText("Bebidas");
    fireEvent.click(await screen.findByLabelText("Editar Cerveja"));
    fireEvent.change(screen.getByLabelText("Custo unitário"), {
      target: { value: "4,50" },
    });
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "PATCH",
      path: "/products/3",
      body: { costOverride: "450" },
    });
  });
});

describe("the daily close", () => {
  test("shows each day's figures and says which are provisional", async () => {
    const close = (businessDate: string, provisional: boolean) => ({
      businessDate,
      currency: "BRL",
      sold: "12000",
      cost: "4000",
      missingCost: provisional ? ["9"] : [],
      fixedShare: "155000",
      result: "-147000",
      provisional,
    });
    api({
      "/daily-closes": {
        items: [close("2026-10-30", false), close("2026-10-31", true)],
      },
    });
    render(<DailyCloseScreen bookId="1" />);
    expect(await screen.findByText("2026-10-30")).toBeDefined();
    expect(screen.getByText("Fechado")).toBeDefined();
    expect(screen.getByText("Provisório")).toBeDefined();
    expect(screen.getByText("1 sem custo")).toBeDefined();
    expect(screen.getAllByText("−1.470,00")).toHaveLength(2);
  });
});
