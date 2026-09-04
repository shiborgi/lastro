import { describe, expect, test } from "bun:test";
import { themeVariables } from "@lastro/ui/tokens";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { CreateExpenseDialog } from "../components/create-dialogs";
import { SettleDialog } from "../components/settle-dialogs";
import type { ApiClient, FinancialResource } from "../lib/api";

function stubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    createExpense: async () => ({ expense: { id: "e-1" } }),
    createExpenseSettlement: async () => ({ settlement: { id: "s-1" } }),
    ...overrides,
  } as unknown as ApiClient;
}

function mountTheme() {
  const style = document.createElement("style");
  style.id = "lastro-web-theme";
  style.textContent = `:root{${themeVariables("light")}}`;
  document.head.appendChild(style);
}

async function seriousViolations(container: HTMLElement) {
  // Contrast checks stay enabled in apps/web: whatever axe reports is the
  // verdict. Incomplete results are surfaced, never silenced.
  const results = await axe.run(container);
  return results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
}

const payments: FinancialResource[] = [
  {
    id: "p-1",
    bookId: "1",
    amountMinor: "1000",
    currency: "BRL",
  } as FinancialResource,
];

describe("dialog accessibility (contrast enabled)", () => {
  test("create-expense dialog has named fields and no serious axe violations", async () => {
    mountTheme();
    const { container } = render(
      <CreateExpenseDialog
        client={stubClient()}
        bookId="1"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(container.querySelector('[aria-label="Account id"]')).toBeTruthy();
    expect(
      container.querySelector('[aria-label="Amount (minor units)"]'),
    ).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
  });

  test("settle dialog has named controls and no serious axe violations", async () => {
    mountTheme();
    const { container } = render(
      <SettleDialog
        client={stubClient()}
        bookId="1"
        expense={{ id: "e-1", amountMinor: "1000", currency: "BRL" }}
        payments={payments}
        onClose={() => {}}
        onSettled={() => {}}
      />,
    );
    expect(container.querySelector('[aria-label="Payment"]')).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
  });

  test("failed submit surfaces the error with role=alert", async () => {
    mountTheme();
    const client = stubClient({
      createExpense: async () => {
        throw new Error("409 insufficient available balance");
      },
    });
    const { container } = render(
      <CreateExpenseDialog
        client={client}
        bookId="1"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    const form = container.querySelector("form");
    // Submit the form directly: synthetic clicks trip React's input-value
    // polyfill under jsdom (missing attachEvent), while submit exercises
    // the same onSubmit → error → role=alert path.
    await act(async () => {
      if (form) fireEvent.submit(form);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain("409");
  });
});
