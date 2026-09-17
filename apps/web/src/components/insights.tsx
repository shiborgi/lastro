"use client";

import {
  type BookInsights,
  type PositionItem,
  type RevenuePositionItem,
  api,
} from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

/**
 * What the summary is for: how far the books are behind the bank, where the
 * money actually moved, and what the booked records add up to.
 *
 * One domain decision shapes every chart here. An account statement is a cash
 * timeline — each line is money that left or arrived on that date. A card
 * invoice is not: its lines carry the date the purchase was made, so an
 * instalment bought in April sits on a September bill. Plotting invoices on a
 * daily axis would show spending in months when nothing left the bank, so the
 * daily series reads account statements only and says which.
 */

const MONEY = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(cents: bigint | string): string {
  const value = typeof cents === "string" ? BigInt(cents) : cents;
  const negative = value < 0n;
  const body = MONEY.format(Number(negative ? -value : value) / 100);
  return negative ? `−${body}` : body;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ── the gap ────────────────────────────────────────────────────────────── */

/**
 * The hero is a relation, not a figure. A single big number says nothing here;
 * the distance between what the statements hold and what the ledger has
 * recorded is the state of the work, and it is the one thing worth reading
 * first.
 */
function Gap({
  gap,
  onReview,
}: {
  gap: BookInsights["gap"];
  onReview: () => void;
}) {
  const behind = gap.stagedMovements - gap.postedMovements;
  return (
    <section className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
      <div className="space-y-1">
        <p className="text-lg leading-snug">
          <span className="tabular text-4xl font-bold tracking-tight">
            {behind}
          </span>{" "}
          movimentos ainda não estão no razão.
        </p>
        <p className="text-sm text-muted-foreground">
          {gap.ledgerRecords === 0
            ? "Nada lançado ainda."
            : `${gap.ledgerRecords} ${gap.ledgerRecords === 1 ? "lançamento" : "lançamentos"} no razão.`}{" "}
          {gap.descriptorsPending} de {gap.descriptors} descritores esperam uma
          decisão.
        </p>
      </div>
      {behind > 0 ? (
        <button
          type="button"
          onClick={onReview}
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Revisar
        </button>
      ) : null}
    </section>
  );
}

/* ── caixa por dia ──────────────────────────────────────────────────────── */

type Day = { date: string; inflow: string; outflow: string };

/**
 * Diverging bars on one axis: in above the baseline, out below it.
 *
 * Position carries the sign, so a reader who cannot tell the two hues apart
 * still reads the chart correctly — colour only reinforces. One scale serves
 * both directions, which is what keeps a large inflow and a large outflow
 * visually comparable; a second axis would make them lie.
 */
function CashChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const peak = useMemo(() => {
    let top = 1n;
    for (const day of days) {
      const inflow = BigInt(day.inflow);
      const outflow = BigInt(day.outflow);
      if (inflow > top) top = inflow;
      if (outflow > top) top = outflow;
    }
    return top;
  }, [days]);

  const width = Math.max(days.length * 22, 220);
  const half = 92;
  const height = half * 2 + 26;
  const scale = (value: bigint) =>
    (Number((value * 1000n) / peak) / 1000) * (half - 6);

  const active = hover === null ? null : days[hover];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm bg-flow-in"
          />
          entrou
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm bg-flow-out"
          />
          saiu
        </span>
        {/*
         * The hovered day, as labelled values rather than one string joined by
         * separators — three facts read faster as three than as a sentence.
         */}
        {active ? (
          <span className="ml-auto flex items-baseline gap-3">
            <span className="tabular font-medium text-foreground">
              {dayLabel(active.date)}
            </span>
            <span className="tabular">
              entrou{" "}
              <span className="text-foreground">{money(active.inflow)}</span>
            </span>
            <span className="tabular">
              saiu{" "}
              <span className="text-foreground">{money(active.outflow)}</span>
            </span>
          </span>
        ) : (
          <span className="tabular ml-auto">maior dia {money(peak)}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Entradas e saídas por dia"
          className="block"
        >
          {/* Recessive baseline: the zero it diverges from. */}
          <line
            x1="0"
            y1={half}
            x2={width}
            y2={half}
            stroke="currentColor"
            strokeWidth="1"
            className="text-border"
          />
          {days.map((day, index) => {
            const x = index * 22 + 5;
            const inflow = scale(BigInt(day.inflow));
            const outflow = scale(BigInt(day.outflow));
            return (
              <g
                key={day.date}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                {/* A hit target wider than the marks. */}
                <rect
                  x={index * 22}
                  y="0"
                  width="22"
                  height={half * 2}
                  fill="transparent"
                />
                {inflow > 0.5 ? (
                  <rect
                    x={x}
                    y={half - inflow}
                    width="12"
                    height={inflow}
                    rx="3"
                    className="fill-flow-in"
                    opacity={hover === null || hover === index ? 1 : 0.45}
                  />
                ) : null}
                {outflow > 0.5 ? (
                  <rect
                    x={x}
                    y={half + 2}
                    width="12"
                    height={outflow}
                    rx="3"
                    className="fill-flow-out"
                    opacity={hover === null || hover === index ? 1 : 0.45}
                  />
                ) : null}
              </g>
            );
          })}
          {/* Only the ends are labelled: a number on every day would be noise. */}
          {days.length > 0 ? (
            <>
              <text
                x="5"
                y={height - 6}
                className="fill-muted-foreground text-[10px]"
              >
                {dayLabel(days[0]?.date ?? "")}
              </text>
              <text
                x={width - 5}
                y={height - 6}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {dayLabel(days.at(-1)?.date ?? "")}
              </text>
            </>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

/* ── para onde vai ──────────────────────────────────────────────────────── */

/**
 * Magnitude across a handful of named things, so horizontal bars sorted by
 * size — not a donut, which makes exactly this comparison harder. One series,
 * so no legend: the heading names it and each bar is labelled directly.
 */
function GroupChart({
  rows,
  onReview,
}: {
  rows: BookInsights["byGroup"];
  onReview: () => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
        Nada lançado ainda, então não há o que somar. Decida os descritores em{" "}
        <button
          type="button"
          onClick={onReview}
          className="text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Revisão
        </button>{" "}
        e os totais aparecem aqui.
      </p>
    );
  }

  const peak = rows.reduce((top, row) => {
    const value =
      BigInt(row.total) < 0n ? -BigInt(row.total) : BigInt(row.total);
    return value > top ? value : top;
  }, 1n);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const value = BigInt(row.total);
        const magnitude = value < 0n ? -value : value;
        const percent = Number((magnitude * 1000n) / peak) / 10;
        return (
          <li key={`${row.group ?? ""}/${row.category}`} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span>
                {row.group ? (
                  <span className="text-muted-foreground">{row.group} › </span>
                ) : null}
                {row.category}
              </span>
              <span className="tabular font-medium">{money(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-sm bg-muted">
              <div
                className={`h-full rounded-sm ${row.kind === "REVENUE" ? "bg-flow-in" : "bg-flow-out"}`}
                style={{ width: `${Math.max(percent, 1.5)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── em aberto ──────────────────────────────────────────────────────────── */

/**
 * What is owed and what is owable, which is the one thing the old position
 * screen said that a total by currency could not.
 *
 * Status is never signalled by colour alone — the word carries it, so the row
 * reads the same to anyone. Settled rows are absent by design: a queue shows
 * what is left, not what is done.
 */
const OUTSTANDING: Record<PositionItem["status"], string> = {
  OPEN: "em aberto",
  PARTIALLY_SETTLED: "parcial",
  SETTLED: "liquidado",
};

function Outstanding({
  payable,
  receivable,
}: {
  payable: PositionItem[];
  receivable: RevenuePositionItem[];
}) {
  const rows = [
    ...payable
      .filter((item) => item.status !== "SETTLED")
      .map((item) => ({
        id: `p-${item.expense.id}`,
        side: "a pagar" as const,
        key: item.expense.key,
        outstanding: item.outstanding,
        status: item.status,
      })),
    ...receivable
      .filter((item) => item.status !== "SETTLED")
      .map((item) => ({
        id: `r-${item.revenue.id}`,
        side: "a receber" as const,
        key: item.revenue.key,
        outstanding: item.outstanding,
        status: item.status,
      })),
  ];

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
        Nada em aberto. Toda despesa e receita lançada está liquidada.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">Lado</th>
            <th className="py-1.5 font-medium">Registro</th>
            <th className="py-1.5 font-medium">Situação</th>
            <th className="py-1.5 text-right font-medium">Falta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60">
              <td className="py-1.5 text-muted-foreground">{row.side}</td>
              <td className="py-1.5">{row.key}</td>
              <td className="py-1.5 text-muted-foreground">
                {OUTSTANDING[row.status]}
              </td>
              <td className="tabular py-1.5 text-right font-medium">
                {money(row.outstanding)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────── */

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2>{title}</h2>
        {note ? (
          <p className="max-w-prose text-sm text-muted-foreground">{note}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Insights({
  bookId,
  onReview,
}: {
  bookId: string;
  onReview: () => void;
}) {
  const [data, setData] = useState<BookInsights | null>(null);
  const [payable, setPayable] = useState<PositionItem[]>([]);
  const [receivable, setReceivable] = useState<RevenuePositionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    Promise.all([
      api.getInsights(bookId),
      api.getPosition(bookId),
      api.getRevenuePosition(bookId),
    ])
      .then(([result, position, revenue]) => {
        if (!active) return;
        setData(result);
        setSource(result.cash[0]?.source ?? null);
        setPayable(position.expenses.items);
        setReceivable(revenue.revenues.items);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const chosen =
    data.cash.find((entry) => entry.source === source) ?? data.cash[0];

  return (
    <div className="space-y-8">
      <Gap gap={data.gap} onReview={onReview} />

      <Panel
        title="Caixa por dia"
        note="Só extratos de conta. Uma fatura de cartão datar a compra, não o pagamento — a parcela comprada em abril está na fatura de setembro, e plotá-la por data de compra mostraria gasto num mês em que nada saiu do banco."
      >
        {data.cash.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
            Nenhum extrato de conta importado.
          </p>
        ) : (
          <div className="space-y-3">
            {data.cash.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.cash.map((entry) => (
                  <button
                    key={entry.source}
                    type="button"
                    onClick={() => setSource(entry.source)}
                    aria-pressed={entry.source === chosen?.source}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      entry.source === chosen?.source
                        ? "border-border bg-card font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {entry.source}
                  </button>
                ))}
              </div>
            ) : null}
            {chosen ? <CashChart days={chosen.days} /> : null}
            {/* A table view, so the chart is never the only way to read it. */}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Ver os números
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">Dia</th>
                      <th className="py-1.5 text-right font-medium">Entrou</th>
                      <th className="py-1.5 text-right font-medium">Saiu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(chosen?.days ?? []).map((day) => (
                      <tr key={day.date} className="border-b border-border/60">
                        <td className="tabular py-1.5">{dayLabel(day.date)}</td>
                        <td className="tabular py-1.5 text-right">
                          {money(day.inflow)}
                        </td>
                        <td className="tabular py-1.5 text-right">
                          {money(day.outflow)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </Panel>

      <Panel
        title="Em aberto"
        note="O que falta pagar e receber dos lançamentos já no razão."
      >
        <Outstanding payable={payable} receivable={receivable} />
      </Panel>

      <Panel
        title="Para onde vai"
        note="Totais do razão, por grupo e categoria. Só o que já foi promovido conta aqui."
      >
        <GroupChart rows={data.byGroup} onReview={onReview} />
      </Panel>
    </div>
  );
}
