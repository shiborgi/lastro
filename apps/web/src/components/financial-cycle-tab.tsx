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
import { type CatalogRecord, type FinancialRecord, api } from "@/lib/api";
import { formatAmount } from "@/lib/money";
import { useEffect, useMemo, useState } from "react";

/**
 * A financial cycle as two benches that answer each other, instead of three
 * flat tables that left the join to the reader.
 *
 * A settlement is the join between a debt and an instrument that discharges
 * it — an expense and a payment, or a revenue and a receipt — and on its own
 * it answers neither of the two questions anyone actually has: "who did I pay
 * for this debt" and "what did this transfer settle". Listing it as a fourth
 * table meant cross-referencing three ids by eye. Here it never stands
 * alone — it opens out of the debt it discharges or the instrument that
 * carries it, so the settlement is evidence for a row, not a row of its own.
 *
 * The two cycles share this one component because they now share the same
 * shape in the same direction: a financed purchase and a day's card-acquirer
 * earnings both aggregate on the primary side. A financed purchase is one
 * expense with twelve settlements, each against a different month's shared
 * card bill — opening the expense lists all twelve payments, opening any one
 * of those payments lists every other expense billed on the same invoice
 * beside it. A day's earnings are one revenue with several settlements, each
 * against a receipt for one deposit line the bank actually posted — opening
 * the revenue lists every deposit that fed it, opening any one of those
 * receipts finds the same revenue.
 *
 * The one place the shapes genuinely differ: an expense settlement carries an
 * instalment number, because a card debt has a schedule; a revenue settlement
 * carries a description instead, because a day's deposit has none — it has
 * only the descriptor that says which flag each part came from. That is the
 * one column that switches on `kind`; everything around it is identical.
 */

type CycleKind = "expense" | "revenue";

const COPY: Record<
  CycleKind,
  {
    primaryResource: "expenses" | "revenues";
    secondaryResource: "payments" | "receipts";
    settlementResource: "expense-settlements" | "revenue-settlements";
    primaryTitle: string;
    secondaryTitle: string;
    primaryEmpty: string;
    secondaryEmpty: string;
    /** [singular, plural] of what the *other* side counts as, from here. */
    primaryCounts: [string, string];
    secondaryCounts: [string, string];
    primaryNoSettlements: string;
    secondaryNoSettlements: string;
    settlementHeader: string;
  }
> = {
  expense: {
    primaryResource: "expenses",
    secondaryResource: "payments",
    settlementResource: "expense-settlements",
    primaryTitle: "Despesas",
    secondaryTitle: "Pagamentos",
    primaryEmpty: "Nenhuma despesa registrada neste Book.",
    secondaryEmpty: "Nenhum pagamento registrado neste Book.",
    primaryCounts: ["pagamento", "pagamentos"],
    secondaryCounts: ["despesa", "despesas"],
    primaryNoSettlements: "Nenhum pagamento ligado a esta despesa ainda.",
    secondaryNoSettlements: "Nenhuma despesa ligada a este pagamento ainda.",
    settlementHeader: "Parcela",
  },
  revenue: {
    primaryResource: "revenues",
    secondaryResource: "receipts",
    settlementResource: "revenue-settlements",
    primaryTitle: "Receitas",
    secondaryTitle: "Recebimentos",
    primaryEmpty: "Nenhuma receita registrada neste Book.",
    secondaryEmpty: "Nenhum recebimento registrado neste Book.",
    primaryCounts: ["recebimento", "recebimentos"],
    secondaryCounts: ["receita", "receitas"],
    primaryNoSettlements: "Nenhum recebimento ligado a esta receita ainda.",
    secondaryNoSettlements: "Nenhuma receita ligada a este recebimento ainda.",
    settlementHeader: "Descrição",
  },
};

function shortDate(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function StatusBadge({ voidedAt }: { voidedAt?: string | null }) {
  return (
    <Badge variant={voidedAt ? "outline" : "secondary"}>
      {voidedAt ? "Anulada" : "Ativa"}
    </Badge>
  );
}

/** The settlement's own detail column: an instalment, or a description. */
function SettlementDetail({
  kind,
  settlement,
}: {
  kind: CycleKind;
  settlement: FinancialRecord;
}) {
  if (kind === "expense") {
    return (
      <TableCell className="tabular whitespace-nowrap">
        {settlement.installmentNumber ?? "—"}/
        {settlement.installmentCount ?? "—"}
      </TableCell>
    );
  }
  return (
    <TableCell className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">
      {settlement.description || "—"}
    </TableCell>
  );
}

function primaryIdOf(
  kind: CycleKind,
  row: FinancialRecord,
): string | undefined {
  return kind === "expense" ? row.expenseId : row.revenueId;
}

function secondaryIdOf(
  kind: CycleKind,
  row: FinancialRecord,
): string | undefined {
  return kind === "expense" ? row.paymentId : row.receiptId;
}

function CycleTab({ bookId, kind }: { bookId: string; kind: CycleKind }) {
  const copy = COPY[kind];
  const [primary, setPrimary] = useState<FinancialRecord[] | null>(null);
  const [secondary, setSecondary] = useState<FinancialRecord[] | null>(null);
  const [settlements, setSettlements] = useState<FinancialRecord[] | null>(
    null,
  );
  const [parties, setParties] = useState<CatalogRecord[]>([]);
  const [categories, setCategories] = useState<CatalogRecord[]>([]);
  const [accounts, setAccounts] = useState<CatalogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openPrimary, setOpenPrimary] = useState<Set<string>>(new Set());
  const [openSecondary, setOpenSecondary] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setPrimary(null);
    setSecondary(null);
    setSettlements(null);
    setError(null);
    Promise.all([
      api.listFinancial(bookId, copy.primaryResource),
      api.listFinancial(bookId, copy.secondaryResource),
      api.listFinancial(bookId, copy.settlementResource),
      api.listCatalog(bookId, "parties"),
      api.listCatalog(bookId, "categories"),
      api.listCatalog(bookId, "accounts"),
    ])
      .then(([p, s, st, party, category, account]) => {
        if (!active) return;
        setPrimary(p.items);
        setSecondary(s.items);
        setSettlements(st.items);
        setParties(party.items);
        setCategories(category.items);
        setAccounts(account.items);
      })
      .catch((cause: Error) => {
        if (!active) return;
        setError(cause.message);
        setPrimary([]);
        setSecondary([]);
        setSettlements([]);
      });
    return () => {
      active = false;
    };
  }, [
    bookId,
    copy.primaryResource,
    copy.secondaryResource,
    copy.settlementResource,
  ]);

  const byPrimary = useMemo(() => {
    const map = new Map<string, FinancialRecord[]>();
    for (const row of settlements ?? []) {
      const id = primaryIdOf(kind, row);
      if (!id) continue;
      const list = map.get(id) ?? [];
      list.push(row);
      map.set(id, list);
    }
    return map;
  }, [settlements, kind]);

  const bySecondary = useMemo(() => {
    const map = new Map<string, FinancialRecord[]>();
    for (const row of settlements ?? []) {
      const id = secondaryIdOf(kind, row);
      if (!id) continue;
      const list = map.get(id) ?? [];
      list.push(row);
      map.set(id, list);
    }
    return map;
  }, [settlements, kind]);

  const partyName = (id?: string | null) =>
    String(parties.find((p) => p.id === id)?.name ?? id ?? "—");
  const categoryName = (id?: string | null) =>
    String(categories.find((c) => c.id === id)?.name ?? id ?? "—");
  const accountName = (id?: string | null) =>
    String(accounts.find((a) => a.id === id)?.name ?? id ?? "—");
  const primaryById = (id?: string) =>
    (primary ?? []).find((row) => row.id === id);
  const secondaryById = (id?: string) =>
    (secondary ?? []).find((row) => row.id === id);

  function toggle(
    set: Set<string>,
    setter: (next: Set<string>) => void,
    id: string,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (primary === null || secondary === null || settlements === null) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3" aria-label={copy.primaryTitle}>
        <h3 className="text-sm font-medium text-muted-foreground">
          {copy.primaryTitle}
        </h3>
        {primary.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.primaryEmpty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {primary.map((record) => {
              const rows = byPrimary.get(record.id) ?? [];
              const expanded = openPrimary.has(record.id);
              return (
                <li key={record.id} className="px-3 py-2">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      toggle(openPrimary, setOpenPrimary, record.id)
                    }
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-md py-1 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {record.name || record.key || record.id}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {partyName(record.partyId)} ·{" "}
                        {categoryName(record.categoryId)}
                      </span>
                    </span>
                    <span className="tabular text-sm whitespace-nowrap">
                      {formatAmount(record.amount, record.currency)}
                    </span>
                    <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                      {shortDate(record.occurredAt)}
                    </span>
                    <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                      {rows.length}{" "}
                      {rows.length === 1
                        ? copy.primaryCounts[0]
                        : copy.primaryCounts[1]}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="mt-2 overflow-x-auto border-t border-dashed border-border pt-2">
                      {rows.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {copy.primaryNoSettlements}
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{copy.settlementHeader}</TableHead>
                              <TableHead>
                                {copy.secondaryTitle.slice(0, -1)}
                              </TableHead>
                              <TableHead>Vencimento</TableHead>
                              <TableHead>Pago em</TableHead>
                              <TableHead>Valor</TableHead>
                              <TableHead>Estado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((settlement) => {
                              const other = secondaryById(
                                secondaryIdOf(kind, settlement),
                              );
                              return (
                                <TableRow key={settlement.id}>
                                  <SettlementDetail
                                    kind={kind}
                                    settlement={settlement}
                                  />
                                  <TableCell>
                                    {other
                                      ? `${accountName(other.accountId)} · ${shortDate(other.referenceMonth)}`
                                      : (secondaryIdOf(kind, settlement) ??
                                        "—")}
                                  </TableCell>
                                  <TableCell className="tabular whitespace-nowrap">
                                    {shortDate(other?.dueAt)}
                                  </TableCell>
                                  <TableCell className="tabular whitespace-nowrap">
                                    {shortDate(other?.paidAt)}
                                  </TableCell>
                                  <TableCell className="tabular whitespace-nowrap">
                                    {formatAmount(
                                      settlement.amount,
                                      settlement.currency,
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <StatusBadge
                                      voidedAt={settlement.voidedAt}
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
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

      <section className="space-y-3" aria-label={copy.secondaryTitle}>
        <h3 className="text-sm font-medium text-muted-foreground">
          {copy.secondaryTitle}
        </h3>
        {secondary.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.secondaryEmpty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {secondary.map((record) => {
              const rows = bySecondary.get(record.id) ?? [];
              const expanded = openSecondary.has(record.id);
              return (
                <li key={record.id} className="px-3 py-2">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      toggle(openSecondary, setOpenSecondary, record.id)
                    }
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-3 rounded-md py-1 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {accountName(record.accountId)}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {record.key ?? record.id}
                      </span>
                    </span>
                    <span className="tabular text-sm whitespace-nowrap">
                      {formatAmount(record.amount, record.currency)}
                    </span>
                    <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                      {shortDate(record.referenceMonth)}
                    </span>
                    <Badge variant={record.paidAt ? "secondary" : "outline"}>
                      {record.paidAt
                        ? `Pago em ${shortDate(record.paidAt)}`
                        : "Pendente"}
                    </Badge>
                    <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
                      {rows.length}{" "}
                      {rows.length === 1
                        ? copy.secondaryCounts[0]
                        : copy.secondaryCounts[1]}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="mt-2 overflow-x-auto border-t border-dashed border-border pt-2">
                      {rows.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {copy.secondaryNoSettlements}
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{copy.settlementHeader}</TableHead>
                              <TableHead>
                                {copy.primaryTitle.slice(0, -1)}
                              </TableHead>
                              {kind === "expense" ? (
                                <TableHead>Data</TableHead>
                              ) : null}
                              <TableHead>Parte · Categoria</TableHead>
                              <TableHead>Valor</TableHead>
                              <TableHead>Estado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((settlement) => {
                              const other = primaryById(
                                primaryIdOf(kind, settlement),
                              );
                              return (
                                <TableRow key={settlement.id}>
                                  <SettlementDetail
                                    kind={kind}
                                    settlement={settlement}
                                  />
                                  <TableCell>
                                    {other
                                      ? other.name || other.key || other.id
                                      : (primaryIdOf(kind, settlement) ?? "—")}
                                  </TableCell>
                                  {kind === "expense" ? (
                                    <TableCell className="tabular whitespace-nowrap">
                                      {shortDate(other?.occurredAt)}
                                    </TableCell>
                                  ) : null}
                                  <TableCell className="whitespace-nowrap">
                                    {other
                                      ? `${partyName(other.partyId)} · ${categoryName(other.categoryId)}`
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="tabular whitespace-nowrap">
                                    {formatAmount(
                                      settlement.amount,
                                      settlement.currency,
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <StatusBadge
                                      voidedAt={settlement.voidedAt}
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
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
    </div>
  );
}

export function ExpenseCycleTab({ bookId }: { bookId: string }) {
  return <CycleTab bookId={bookId} kind="expense" />;
}

export function RevenueCycleTab({ bookId }: { bookId: string }) {
  return <CycleTab bookId={bookId} kind="revenue" />;
}
