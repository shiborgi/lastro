"use client";

import {
  Button,
  type Column,
  Dialog,
  FinancialTable,
  StatusBadge,
  formatMinorUnits,
} from "@lastro/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiClient,
  type FinancialResource,
  type PositionItem,
} from "../lib/api";
import { CreateExpenseDialog, CreatePaymentDialog } from "./create-dialogs";
import { SettleDialog, VoidDialog } from "./settle-dialogs";

type WorkflowState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

type ExpenseRow = {
  id: string;
  amountMinor: string;
  currency: string;
  status: "OPEN" | "PARTIALLY_SETTLED" | "SETTLED";
};

export function ExpenseWorkflow({
  apiUrl,
  token,
  bookId,
}: {
  apiUrl: string;
  token: string;
  bookId: string;
}) {
  const client = useMemo(() => new ApiClient(apiUrl, token), [apiUrl, token]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payments, setPayments] = useState<FinancialResource[]>([]);
  const [settlements, setSettlements] = useState<FinancialResource[]>([]);
  const [state, setState] = useState<WorkflowState>({ kind: "loading" });
  const [showCreateExpense, setShowCreateExpense] = useState(false);
  const [showCreatePayment, setShowCreatePayment] = useState(false);
  const [settleTarget, setSettleTarget] = useState<ExpenseRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<{
    settlementId: string;
    impact: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [expensePage, paymentPage, settlementPage] = await Promise.all([
        client.listExpenses(bookId),
        client.listPayments(bookId),
        client.listExpenseSettlements(bookId),
      ]);
      setExpenses(
        expensePage.items.map((item) => ({
          id: item.id,
          amountMinor: item.amountMinor,
          currency: item.currency,
          status: "OPEN" as const,
        })),
      );
      setPayments(paymentPage.items);
      setSettlements(settlementPage.items);
      setState({ kind: "ready" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load",
      });
    }
  }, [client, bookId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const columns: Column<ExpenseRow>[] = [
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
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button variant="primary" onClick={() => setSettleTarget(row)}>
          Settle
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section
        aria-label="Expenses"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Expenses</h2>
          <Button onClick={() => setShowCreateExpense(true)}>
            New expense
          </Button>
        </div>
        {state.kind === "loading" ? (
          <p>Loading…</p>
        ) : state.kind === "error" ? (
          <p style={{ color: "var(--lastro-danger)" }}>{state.message}</p>
        ) : (
          <FinancialTable
            columns={columns}
            rows={expenses}
            rowKey={(row) => row.id}
            emptyMessage="No expenses."
          />
        )}
      </section>

      <section
        aria-label="Payments"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Payments</h2>
          <Button onClick={() => setShowCreatePayment(true)}>
            New payment
          </Button>
        </div>
        {payments.length === 0 ? (
          <p style={{ color: "var(--lastro-text-muted)" }}>No payments.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {payments.map((payment) => (
              <li
                key={payment.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid var(--lastro-surface-muted)",
                }}
              >
                <span>{payment.id}</span>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: "var(--lastro-font-mono)",
                  }}
                >
                  {formatMinorUnits(payment.amountMinor, payment.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {feedback ? (
        <p style={{ color: "var(--lastro-success)" }}>{feedback}</p>
      ) : null}

      <section
        aria-label="Settlements"
        style={{
          border: "2px solid var(--lastro-border)",
          background: "var(--lastro-surface)",
          padding: "1rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", marginBottom: "0.5rem" }}>
          Settlements
        </h2>
        {settlements.length === 0 ? (
          <p style={{ color: "var(--lastro-text-muted)" }}>No settlements.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {settlements.map((settlement) => (
              <li
                key={settlement.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid var(--lastro-surface-muted)",
                }}
              >
                <span>
                  {settlement.id} · {settlement.expenseId} →{" "}
                  {settlement.paymentId}
                </span>
                <Button
                  variant="danger"
                  onClick={() =>
                    setVoidTarget({
                      settlementId: settlement.id,
                      impact: `expense ${settlement.expenseId} and payment ${settlement.paymentId}`,
                    })
                  }
                >
                  Void
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCreateExpense ? (
        <CreateExpenseDialog
          client={client}
          bookId={bookId}
          onClose={() => setShowCreateExpense(false)}
          onCreated={async (message) => {
            setShowCreateExpense(false);
            setFeedback(message);
            await refresh();
          }}
        />
      ) : null}

      {showCreatePayment ? (
        <CreatePaymentDialog
          client={client}
          bookId={bookId}
          onClose={() => setShowCreatePayment(false)}
          onCreated={async (message) => {
            setShowCreatePayment(false);
            setFeedback(message);
            await refresh();
          }}
        />
      ) : null}

      {settleTarget ? (
        <SettleDialog
          client={client}
          bookId={bookId}
          expense={settleTarget}
          payments={payments}
          onClose={() => setSettleTarget(null)}
          onSettled={async (message) => {
            setSettleTarget(null);
            setFeedback(message);
            await refresh();
          }}
        />
      ) : null}

      {voidTarget ? (
        <VoidDialog
          client={client}
          bookId={bookId}
          target={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={async (message) => {
            setVoidTarget(null);
            setFeedback(message);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
