/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ACCOUNTS } from "@/modules/finance/catalogs";
import { ExpensesScreen } from "@/modules/finance/expenses";
import { ResourceScreen } from "@/shell/resource-screen";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";

type Sent = { method: string; path: string; body: unknown; key: string | null };

/*
 * A fake API routed by method and path. It records every write, which is
 * where screen bugs live, and answers reads from `reads`.
 */
function api(
  reads: Record<string, unknown>,
  writes: Record<
    string,
    (body: unknown, attempt: number) => { status: number; body: unknown }
  > = {},
) {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url, "http://localhost").pathname.replace(
      "/api/backend/v1/books/1",
      "",
    );
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (method === "GET") return json(200, reads[path] ?? { items: [] });
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const key = new Headers(init?.headers).get("idempotency-key");
    sent.push({ method, path, body, key });
    const handler = writes[`${method} ${path}`];
    const answer = handler?.(
      body,
      sent.filter((each) => each.path === path).length,
    ) ?? { status: 200, body: {} };
    return json(answer.status, answer.body);
  }) as unknown as typeof fetch;
  return sent;
}

const account = {
  id: "1",
  bookId: "1",
  key: "bank",
  name: "Bank",
  type: "ACCOUNT",
  institutionId: null,
  number: null,
};

describe("the resource screen", () => {
  test("lists with labels, not enum members, and names each row's actions", async () => {
    api({ "/accounts": { items: [account] } });
    render(<ResourceScreen bookId="1" spec={ACCOUNTS} />);
    await waitFor(() => expect(screen.getByText("Bank")).toBeDefined());
    expect(screen.getByText("Conta")).toBeDefined();
    expect(screen.queryByText("ACCOUNT")).toBeNull();
    expect(screen.getByLabelText("Editar Bank")).toBeDefined();
    expect(screen.getByLabelText("Excluir Bank")).toBeDefined();
    const results = await axe.run(document.body, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    expect(
      results.violations.filter(
        (each) => each.impact === "serious" || each.impact === "critical",
      ),
    ).toEqual([]);
  });

  test("creates with the key suggested from the name, and keeps one idempotency key across a retry", async () => {
    const sent = api(
      { "/accounts": { items: [] } },
      {
        "POST /accounts": (_body, attempt) =>
          attempt === 1
            ? {
                status: 409,
                body: {
                  error: {
                    code: "CONFLICT",
                    message: "a record with the same identity already exists",
                  },
                },
              }
            : { status: 200, body: account },
      },
    );
    render(<ResourceScreen bookId="1" spec={ACCOUNTS} />);
    fireEvent.click(await screen.findByText("Nova conta"));
    fireEvent.change(screen.getByLabelText("Nome *"), {
      target: { value: "Conta Corrente" },
    });
    fireEvent.change(screen.getByLabelText("Tipo *"), {
      target: { value: "ACCOUNT" },
    });
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("same identity"),
    );
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]?.body).toEqual({
      name: "Conta Corrente",
      key: "conta-corrente",
      type: "ACCOUNT",
    });
    expect(sent[0]?.key).toBeTruthy();
    expect(sent[1]?.key).toBe(sent[0]?.key ?? "");
  });

  test("an edit sends only the fields the operator changed", async () => {
    const sent = api({ "/accounts": { items: [account] } });
    render(<ResourceScreen bookId="1" spec={ACCOUNTS} />);
    fireEvent.click(await screen.findByLabelText("Editar Bank"));
    fireEvent.change(screen.getByLabelText("Número"), {
      target: { value: "12345678-9" },
    });
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "PATCH",
      path: "/accounts/1",
      body: { number: "12345678-9" },
    });
  });
});

describe("paying an expense", () => {
  test("sends the share, the account, the date and the discount with its category", async () => {
    const expense = {
      id: "9",
      bookId: "1",
      key: "e",
      partyId: "2",
      financialCategoryId: "3",
      name: "Assaí",
      amount: "100000",
      currency: "BRL",
      referenceMonth: "2026-11-01",
      occurredOn: null,
      occurredAt: null,
    };
    const sent = api({
      "/open-expenses": {
        items: [
          { expense, settled: "0", outstanding: "100000", status: "OPEN" },
        ],
        totals: [{ currency: "BRL", outstanding: "100000", count: 1 }],
      },
      "/accounts": { items: [account] },
      "/financial-categories": {
        items: [
          {
            id: "5",
            bookId: "1",
            kind: "EXPENSE",
            name: "Descontos",
            parentId: null,
            role: "DEDUCTION",
          },
        ],
      },
    });
    render(<ExpensesScreen bookId="1" />);
    fireEvent.click(await screen.findByText("Pagar"));
    await screen.findByText("Bank");
    fireEvent.change(screen.getByLabelText("Conta *"), {
      target: { value: "1" },
    });
    expect(
      (screen.getByLabelText("Valor da parcela *") as HTMLInputElement).value,
    ).toBe("1000,00");
    fireEvent.change(screen.getByLabelText("Desconto obtido"), {
      target: { value: "50,00" },
    });
    await screen.findByText("Descontos");
    fireEvent.change(screen.getByLabelText("Categoria do desconto *"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Pago em *"), {
      target: { value: "2026-11-12" },
    });
    fireEvent.submit(
      screen.getByLabelText("Pago em *").closest("form") as HTMLFormElement,
    );
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: "/expenses/9/pay",
      body: {
        accountId: "1",
        amount: "100000",
        paidOn: "2026-11-12",
        discount: { amount: "5000", financialCategoryId: "5" },
      },
    });
  });
});
