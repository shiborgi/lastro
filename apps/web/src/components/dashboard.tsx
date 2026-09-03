"use client";

import {
  BarChart,
  Button,
  type Column,
  FinancialTable,
  StatusBadge,
  formatMinorUnits,
} from "@lastro/ui";
import { useEffect, useMemo, useState } from "react";
import {
  ApiClient,
  type Book,
  type BookPosition,
  type PositionItem,
} from "../lib/api";

type DashboardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; position: BookPosition };

const columns: Column<PositionItem>[] = [
  { key: "id", header: "Id", render: (row) => row.expense.id },
  {
    key: "amount",
    header: "Outstanding",
    numeric: true,
    render: (row) =>
      formatMinorUnits(row.outstandingMinor, row.expense.currency),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge status={row.status} />,
  },
];

export function Dashboard({
  apiUrl,
  token,
}: { apiUrl: string; token: string }) {
  const client = useMemo(() => new ApiClient(apiUrl, token), [apiUrl, token]);
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [state, setState] = useState<DashboardState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    client
      .listBooks()
      .then(({ books }) => {
        if (cancelled) return;
        setBooks(books);
        setActiveBookId((current) => current ?? books[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Failed to load books",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!activeBookId) return;
    let cancelled = false;
    setState({ kind: "loading" });
    client
      .getPosition(activeBookId)
      .then((position) => {
        if (cancelled) return;
        setState({ kind: "ready", position });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Failed to load position",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, activeBookId]);

  const activeBook = useMemo(
    () => books.find((book) => book.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  return (
    <div style={{ padding: "1rem", maxWidth: "72rem", margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Lastro</h1>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>Book</span>
          <select
            value={activeBookId ?? ""}
            onChange={(event) => setActiveBookId(event.target.value || null)}
            style={{
              fontFamily: "var(--lastro-font-sans)",
              padding: "0.375rem 0.5rem",
              border: "2px solid var(--lastro-border)",
              background: "var(--lastro-surface)",
              color: "var(--lastro-text)",
            }}
          >
            {books.length === 0 ? (
              <option value="">No books</option>
            ) : (
              books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))
            )}
          </select>
        </label>
      </header>

      {activeBook ? (
        <p style={{ color: "var(--lastro-text-muted)", marginTop: 0 }}>
          Active book: {activeBook.name}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p>Loading…</p>
      ) : state.kind === "error" ? (
        <p style={{ color: "var(--lastro-danger)" }}>{state.message}</p>
      ) : (
        <DashboardContent position={state.position} />
      )}
    </div>
  );
}

function DashboardContent({ position }: { position: BookPosition }) {
  const chartData = position.totals.map((total) => ({
    label: total.currency,
    value: Number.parseInt(total.outstandingMinor, 10) || 0,
  }));

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section
        aria-label="Financial position"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Financial position</h2>
        {position.totals.length === 0 ? (
          <p style={{ color: "var(--lastro-text-muted)" }}>
            No outstanding obligations.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {position.totals.map((total) => (
              <li
                key={total.currency}
                style={{ display: "flex", justifyContent: "space-between" }}
              >
                <span>{total.currency}</span>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: "var(--lastro-font-mono)",
                  }}
                >
                  {formatMinorUnits(total.outstandingMinor, total.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Pending obligations"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Pending obligations</h2>
        <FinancialTable
          columns={columns}
          rows={position.expenses.items}
          rowKey={(row) => row.expense.id}
          emptyMessage="No pending obligations."
        />
      </section>

      <section
        aria-label="Cash summary"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Cash summary</h2>
        {chartData.length === 0 ? (
          <p style={{ color: "var(--lastro-text-muted)" }}>No cash activity.</p>
        ) : (
          <BarChart data={chartData} ariaLabel="Outstanding by currency" />
        )}
      </section>

      <section
        aria-label="Agent activity"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Agent activity</h2>
        <p style={{ color: "var(--lastro-text-muted)" }}>
          No agent activity recorded.
        </p>
      </section>
    </div>
  );
}
