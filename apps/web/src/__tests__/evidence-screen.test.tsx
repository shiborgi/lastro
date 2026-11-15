/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { SaleMovementsScreen } from "@/modules/sales/sale-movements";
import { intakeSummary } from "@/shell/evidence-screen";
import { groupsOf } from "@/shell/registry";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

type Sent = { method: string; path: string; query: string; body: unknown };

/* A fake API: answers reads from `reads` and records every call. */
function api(reads: Record<string, unknown>, write: unknown = {}) {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const method = init?.method ?? "GET";
    const path = parsed.pathname.replace("/api/backend/v1/books/1", "");
    sent.push({
      method,
      path,
      query: parsed.search,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const body =
      method === "GET"
        ? (reads[path] ?? { items: [], nextCursor: null })
        : write;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return sent;
}

const movement = {
  id: "7",
  bookId: "1",
  fileId: "1",
  externalId: "x",
  businessDate: "2026-10-30",
  code: "12",
  name: "Cerveja",
  providerCategory: null,
  descriptorKey: "12",
  quantity: "3",
  revenue: "3000",
  cost: null,
  currency: "BRL",
  status: "PENDING",
  ignoreReason: null,
};

describe("the evidence screen", () => {
  test("lists pending lines first, with their state named in text", async () => {
    const sent = api({
      "/sale-movements": { items: [movement], nextCursor: null },
    });
    render(<SaleMovementsScreen bookId="1" actions={[]} />);
    expect(await screen.findByText("Cerveja")).toBeDefined();
    expect(screen.getByText("Pendente")).toBeDefined();
    expect(screen.getByText("Classificar")).toBeDefined();
    expect(screen.getByText("Lançar")).toBeDefined();
    const list = sent.find((each) => each.path === "/sale-movements");
    expect(list?.query).toContain("status=PENDING");
  });

  test("ignores a line with the reason the operator gave", async () => {
    const sent = api(
      { "/sale-movements": { items: [movement], nextCursor: null } },
      { ...movement, status: "IGNORED", ignoreReason: "teste" },
    );
    render(<SaleMovementsScreen bookId="1" actions={[]} />);
    fireEvent.click(await screen.findByText("Ignorar"));
    fireEvent.change(screen.getByLabelText("Motivo *"), {
      target: { value: "teste" },
    });
    fireEvent.submit(
      screen.getByLabelText("Motivo *").closest("form") as HTMLFormElement,
    );
    await waitFor(() =>
      expect(
        sent.find((each) => each.path === "/sale-movements/7/ignore")?.body,
      ).toEqual({ reason: "teste" }),
    );
  });

  test("says what an intake did in one line", () => {
    expect(intakeSummary({ alreadyImported: true })).toBe(
      "Arquivo já importado: nada mudou.",
    );
    expect(
      intakeSummary({
        alreadyImported: false,
        new: 2,
        known: 1,
        posted: 2,
        pending: 0,
      }),
    ).toBe("Importado: 2 novas, 1 já conhecidas, 2 lançadas, 0 pendentes.");
  });
});

describe("navigation groups", () => {
  test("gather a module's views under their group, in order of first appearance", () => {
    const view = (id: string, group?: string) => ({
      id,
      label: id,
      group,
      render: () => null,
    });
    const groups = groupsOf({
      id: "m",
      label: "M",
      operations: [],
      views: [view("a", "X"), view("b", "Y"), view("c", "X"), view("d")],
    });
    expect(
      groups.map((each) => [each.group, each.views.map((v) => v.id)]),
    ).toEqual([
      ["X", ["a", "c"]],
      ["Y", ["b"]],
      [undefined, ["d"]],
    ]);
  });
});
