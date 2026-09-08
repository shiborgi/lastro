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
import { type FinancialRecord, api } from "@/lib/api";
import { formatAmount } from "@/lib/money";
import { useEffect, useState } from "react";

export type LedgerSpec = {
  resource: string;
  title: string;
  /** Extra columns beyond key/amount/date that matter for this record type. */
  columns?: readonly {
    header: string;
    field: keyof FinancialRecord;
  }[];
};

export type LedgerGroupSpec = {
  /** Stable key for the sidebar view, e.g. "expense-cycle". */
  id: string;
  title: string;
  resources: readonly LedgerSpec[];
};

function shortDate(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/*
 * The financial cycle is created through the MCP tools or the settlement
 * flows, never edited in place — a confirmed settlement is voided and
 * replaced. These tabs are therefore read surfaces over the same API the
 * agents write to.
 */
function LedgerTable({
  bookId,
  spec,
}: {
  bookId: string;
  spec: LedgerSpec;
}) {
  const [rows, setRows] = useState<FinancialRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    api
      .listFinancial(bookId, spec.resource)
      .then((page) => active && setRows(page.items))
      .catch((cause: Error) => {
        if (!active) return;
        setError(cause.message);
        setRows([]);
      });
    return () => {
      active = false;
    };
  }, [bookId, spec.resource]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        {spec.title}
      </h3>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {spec.title.toLowerCase()} recorded in this Book.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Reference</TableHead>
                {spec.columns?.map((column) => (
                  <TableHead key={column.header}>{column.header}</TableHead>
                ))}
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.key ?? row.id}</TableCell>
                  <TableCell className="tabular">
                    {formatAmount(row.amount, row.currency)}
                  </TableCell>
                  <TableCell>{shortDate(row.referenceMonth)}</TableCell>
                  {spec.columns?.map((column) => (
                    <TableCell key={column.header}>
                      {String(row[column.field] ?? "—")}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Badge variant={row.voidedAt ? "outline" : "secondary"}>
                      {row.voidedAt ? "Voided" : "Active"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function LedgerTab({
  bookId,
  spec,
}: {
  bookId: string;
  spec: LedgerSpec;
}) {
  return (
    <section className="space-y-4" aria-label={spec.title}>
      <h2>{spec.title}</h2>
      <LedgerTable bookId={bookId} spec={spec} />
    </section>
  );
}

export function LedgerGroupTab({
  bookId,
  spec,
}: {
  bookId: string;
  spec: LedgerGroupSpec;
}) {
  return (
    <section className="space-y-6" aria-label={spec.title}>
      <h2>{spec.title}</h2>
      {spec.resources.map((resource) => (
        <LedgerTable key={resource.resource} bookId={bookId} spec={resource} />
      ))}
    </section>
  );
}
