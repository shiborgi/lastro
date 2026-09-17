"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { type CatalogRecord, type Movement, api } from "@/lib/api";
import { formatStatementAmount } from "@/lib/money";
import { useCallback, useEffect, useState } from "react";

/**
 * The staged lines behind the queue.
 *
 * The descriptor bench above works in decisions; this works in rows, and the
 * two answer different questions. "Twenty-one movements wait on this wording"
 * is what makes the queue worth ordering by leverage; "which twenty-one, on
 * what dates, for how much" is what makes a decision checkable before it is
 * made. Neither replaces the other, so both are on the screen.
 *
 * Filtered to PENDING by default, because that is the set the bench is about.
 */

function day(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

const STATUSES = [
  ["PENDING", "Aguardando"],
  ["POSTED", "Lançado"],
  ["IGNORED", "Ignorado"],
] as const;

type Status = (typeof STATUSES)[number][0];

export function MovementsTable({
  bookId,
  side,
}: {
  bookId: string;
  side: "card" | "account";
}) {
  const [status, setStatus] = useState<Status>("PENDING");
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [accounts, setAccounts] = useState<CatalogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [result, listed] = await Promise.all([
        api.listMovements(bookId, side, status),
        api.listCatalog(bookId, "accounts"),
      ]);
      setRows(result.items);
      setAccounts(listed.items);
    } catch (cause) {
      setError((cause as Error).message);
      setRows([]);
    }
  }, [bookId, side, status]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * An invoice dates the purchase; a statement dates the money moving. The
   * column header says which, rather than calling both of them "date" and
   * leaving the reader to assume they mean the same thing.
   */
  const dateHeader = side === "card" ? "Compra" : "Lançamento";

  return (
    <section className="space-y-3" aria-label="Movimentos">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">Movimentos</h3>
        <div className="flex items-baseline gap-2">
          <label
            htmlFor={`status-${side}`}
            className="text-xs text-muted-foreground"
          >
            situação
          </label>
          <select
            id={`status-${side}`}
            value={status}
            onChange={(event) => setStatus(event.target.value as Status)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum movimento nesta situação.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{dateHeader}</th>
                {/* The bench mixes accounts: two statements land in one list. */}
                <th className="px-3 py-2 font-medium">Conta</th>
                <th className="px-3 py-2 font-medium">Descrição</th>
                <th className="px-3 py-2 font-medium">Descritor</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                    {day(row.purchaseDate)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {String(
                      accounts.find((account) => account.id === row.accountId)
                        ?.name ?? row.accountId,
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block">{row.description}</span>
                    {/*
                     * The institution's own words, quoted and never adopted:
                     * a real invoice files "BRASTEMP BY CULLIGAN" under
                     * Aluguel, so this is evidence, not a classification.
                     */}
                    {(row.category ?? row.title) ? (
                      <span className="mt-0.5 block border-l-2 border-border pl-2 font-mono text-xs text-muted-foreground">
                        {row.category ?? row.title}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {row.descriptorKey}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {formatStatementAmount(row.amount, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "movimento" : "movimentos"}
          {side === "card"
            ? " — a fatura registra a data da compra, não a do pagamento."
            : null}
        </p>
      ) : null}
    </section>
  );
}
