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
import {
  type CatalogRecord,
  type FinancialRecord,
  type Movement,
  api,
} from "@/lib/api";
import { formatAmount } from "@/lib/money";
import { useEffect, useMemo, useState } from "react";

/**
 * The transfer cycle as one bench, not two — unlike the expense and revenue
 * cycles, where two ledger resources genuinely exist and a settlement joins
 * them. A transfer has no settlement and no second resource: it names both
 * accounts on the single row it has. Splitting it into "Saídas" and
 * "Entradas" put the same event on two different benches depending on which
 * side you were looking from, which is the wrong shape for something that is
 * already one row — a first version of this screen did exactly that, and
 * looking at real data made the mistake obvious: every transfer showed up on
 * only one of the two benches anyway, because only one statement line had
 * been promoted so far. The two benches were answering a question the data
 * had already answered on its own row.
 *
 * What is still worth opening is the evidence: a transfer is promoted from
 * *two* statement lines — the outflow on the source account's statement and
 * the inflow on the destination account's — reviewed and promoted
 * separately, so one of the two can easily be missing. Expanding a transfer
 * shows whichever of those two lines has been promoted, which is one line
 * more often than two, and that gap is exactly what the badge says.
 */

function shortDate(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function PairingBadge({ count }: { count: number }) {
  if (count >= 2) {
    return <Badge variant="secondary">Completa</Badge>;
  }
  if (count === 1) {
    return <Badge variant="outline">Só um lado</Badge>;
  }
  return <Badge variant="outline">Sem evidência ainda</Badge>;
}

export function TransferCycleTab({ bookId }: { bookId: string }) {
  const [transfers, setTransfers] = useState<FinancialRecord[] | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [accounts, setAccounts] = useState<CatalogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setTransfers(null);
    setMovements(null);
    setError(null);
    Promise.all([
      api.listFinancial(bookId, "transfers"),
      api.listMovements(bookId, "account"),
      api.listCatalog(bookId, "accounts"),
    ])
      .then(([t, m, a]) => {
        if (!active) return;
        setTransfers(t.items);
        // Only the account side — a card charge can never be a transfer —
        // and only the lines a transfer was actually promoted from.
        setMovements(m.items.filter((row) => row.transferId));
        setAccounts(a.items);
      })
      .catch((cause: Error) => {
        if (!active) return;
        setError(cause.message);
        setTransfers([]);
        setMovements([]);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  const evidenceOf = useMemo(() => {
    const map = new Map<string, Movement[]>();
    for (const row of movements ?? []) {
      if (!row.transferId) continue;
      const list = map.get(row.transferId) ?? [];
      list.push(row);
      map.set(row.transferId, list);
    }
    return map;
  }, [movements]);

  const accountName = (id?: string | null) =>
    String(accounts.find((a) => a.id === id)?.name ?? id ?? "—");

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (transfers === null || movements === null) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <section className="space-y-3" aria-label="Transferências">
      {transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma transferência registrada neste Book.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {transfers.map((transfer) => {
            const evidence = evidenceOf.get(transfer.id) ?? [];
            const expanded = open.has(transfer.id);
            return (
              <li key={transfer.id} className="px-3 py-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(transfer.id)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-md py-1 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    {/*
                     * The account pair is a transfer's irreducible identity —
                     * always shown — but once a name exists it leads, the
                     * same as an expense's name leads over its party ·
                     * category. Without one, the first evidence line's own
                     * wording stands in, same as falling back to a bare key.
                     */}
                    <span className="block truncate text-sm">
                      {transfer.name ||
                        `${accountName(transfer.sourceAccountId)} → ${accountName(transfer.destinationAccountId)}`}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {transfer.name
                        ? `${accountName(transfer.sourceAccountId)} → ${accountName(transfer.destinationAccountId)}`
                        : (evidence[0]?.description ?? null)}
                    </span>
                  </span>
                  <span className="tabular text-sm whitespace-nowrap">
                    {formatAmount(transfer.amount, transfer.currency)}
                  </span>
                  <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                    {shortDate(transfer.referenceMonth)}
                  </span>
                  <PairingBadge count={evidence.length} />
                </button>

                {expanded ? (
                  <div className="mt-2 overflow-x-auto border-t border-dashed border-border pt-2">
                    {evidence.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma linha de extrato promovida ainda.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Conta</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead>Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {evidence.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap">
                                {accountName(row.accountId)}
                              </TableCell>
                              <TableCell>{row.description}</TableCell>
                              <TableCell className="tabular whitespace-nowrap">
                                {shortDate(row.purchaseDate)}
                              </TableCell>
                              <TableCell className="tabular whitespace-nowrap">
                                {formatAmount(row.amount, row.currency)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
