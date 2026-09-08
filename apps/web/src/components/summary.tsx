"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type CashFlow, type PositionItem, type Totals, api } from "@/lib/api";
import { formatAmount } from "@/lib/money";
import { useEffect, useState } from "react";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      expenseTotals: Totals[];
      revenueTotals: Totals[];
      pending: PositionItem[];
      cashFlow: CashFlow;
    };

/* Status is never signalled by colour alone — the label carries the meaning. */
const STATUS_LABEL: Record<PositionItem["status"], string> = {
  OPEN: "Open",
  PARTIALLY_SETTLED: "Partial",
  SETTLED: "Settled",
};

/*
 * The stat card: a quiet label above a number set large enough to be read
 * across the room. One card per currency — money from different currencies is
 * never summed, so it is never shown as if it were one figure.
 */
function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
        {value}
      </p>
      {note ? (
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}

function StatGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2>{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function Summary({ bookId }: { bookId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([
      api.getPosition(bookId),
      api.getRevenuePosition(bookId),
      api.getCashFlow(bookId),
    ])
      .then(([position, revenue, cashFlow]) => {
        if (!active) return;
        setState({
          status: "ready",
          expenseTotals: position.totals,
          revenueTotals: revenue.totals,
          pending: position.expenses.items,
          cashFlow,
        });
      })
      .catch((error: Error) => {
        if (active) setState({ status: "error", message: error.message });
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  if (state.status === "loading") {
    return <p className="text-sm text-muted-foreground">Loading summary…</p>;
  }

  if (state.status === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  const { expenseTotals, revenueTotals, cashFlow, pending } = state;
  const flows = [
    { label: "Inflows", buckets: cashFlow.inflows },
    { label: "Outflows", buckets: cashFlow.outflows },
    { label: "Transfers", buckets: cashFlow.transfers },
  ];

  return (
    <div className="space-y-10">
      <StatGroup
        title="Outstanding"
        description="What is owed and what is owed to you, by currency. An expense is not a payment; a revenue is not a receipt."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {expenseTotals.length === 0 && revenueTotals.length === 0 ? (
            <div className="sm:col-span-2 xl:col-span-4">
              <EmptyNote>Nothing outstanding in this Book.</EmptyNote>
            </div>
          ) : (
            <>
              {expenseTotals.map((total) => (
                <StatCard
                  key={`expense-${total.currency}`}
                  label={`Expenses · ${total.currency}`}
                  value={formatAmount(total.outstanding, total.currency)}
                  note={`${total.count} ${total.count === 1 ? "record" : "records"} awaiting payment`}
                />
              ))}
              {revenueTotals.map((total) => (
                <StatCard
                  key={`revenue-${total.currency}`}
                  label={`Revenues · ${total.currency}`}
                  value={formatAmount(total.outstanding, total.currency)}
                  note={`${total.count} ${total.count === 1 ? "record" : "records"} awaiting receipt`}
                />
              ))}
            </>
          )}
        </div>
      </StatGroup>

      <StatGroup
        title="Cash flow"
        description="Money that actually moved. Internal transfers are neither an inflow nor an outflow."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) =>
            flow.buckets.length === 0 ? (
              <StatCard
                key={flow.label}
                label={flow.label}
                value="—"
                note="Nothing recorded"
              />
            ) : (
              flow.buckets.map((bucket) => (
                <StatCard
                  key={`${flow.label}-${bucket.currency}`}
                  label={`${flow.label} · ${bucket.currency}`}
                  value={formatAmount(bucket.amount, bucket.currency)}
                  note={`${bucket.count} ${bucket.count === 1 ? "record" : "records"}`}
                />
              ))
            ),
          )}
        </div>
      </StatGroup>

      <StatGroup
        title="Pending obligations"
        description="Expenses with an unsettled balance."
      >
        {pending.length === 0 ? (
          <EmptyNote>Every expense in this Book is settled.</EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <TableRow key={item.expense.id}>
                    <TableCell className="font-medium">
                      {item.expense.key ?? item.expense.id}
                    </TableCell>
                    <TableCell className="tabular">
                      {formatAmount(item.outstanding, item.expense.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {STATUS_LABEL[item.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </StatGroup>
    </div>
  );
}
