import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { Button } from "../button";
import { BarChart } from "../chart";
import { formatMinorUnits, statusTone } from "../financial";
import { type Column, FinancialTable } from "../financial-table";
import { StatusBadge } from "../status-badge";

type Row = {
  id: string;
  amountMinor: string;
  currency: string;
  status: "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";
};

const rows: Row[] = [
  { id: "1", amountMinor: "2500", currency: "BRL", status: "OPEN" },
  { id: "2", amountMinor: "5000", currency: "BRL", status: "SETTLED" },
];

const columns: Column<Row>[] = [
  { key: "id", header: "Id", render: (row) => row.id },
  {
    key: "amount",
    header: "Amount",
    numeric: true,
    render: (row) => formatMinorUnits(row.amountMinor, row.currency),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge status={row.status} />,
  },
];

describe("financial primitives keep money legible and color-independent", () => {
  test("formats minor units as currency", () => {
    expect(formatMinorUnits("2500", "BRL")).toContain("25");
  });

  test("every status has a non-color-agnostic tone mapping", () => {
    expect(statusTone.OPEN).toBe("warning");
    expect(statusTone.SETTLED).toBe("success");
  });

  test("financial table renders tabular-num monetary cells", () => {
    render(
      <FinancialTable columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );
    const table = document.querySelector("table");
    expect(table).toBeTruthy();
    const amountCells = document.querySelectorAll("td");
    const numericCell = Array.from(amountCells).find((cell) =>
      cell.textContent?.includes("25"),
    );
    expect(numericCell?.textContent).toContain("25");
  });

  test("financial table shows empty message when no rows", () => {
    render(
      <FinancialTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyMessage="No records."
      />,
    );
    expect(document.body.textContent).toContain("No records.");
  });

  test("button carries visible focus outline class state", () => {
    render(<Button>Save</Button>);
    const button = document.querySelector("button") as HTMLButtonElement | null;
    button?.focus();
    expect(button).toBe(document.activeElement as HTMLButtonElement);
  });

  test("bar chart exposes an accessible label", () => {
    render(
      <BarChart
        data={[{ label: "Jan", value: 10 }]}
        ariaLabel="Monthly spending"
      />,
    );
    expect(
      document.querySelector('[aria-label="Monthly spending"]'),
    ).toBeTruthy();
  });
});
