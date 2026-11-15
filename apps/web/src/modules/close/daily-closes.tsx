"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatStatementAmount } from "@/lib/money";
import { ErrorNote, TextField, today, useList } from "@/shell/forms";
/** The derived daily close of a month's posted days. Read only. */
import { listDailyCloses } from "@lastro/close/contracts";
import { useState } from "react";

type Close = {
  businessDate: string;
  sold: string;
  cost: string;
  fixedShare: string;
  result: string;
  provisional: boolean;
  missingCost: string[];
};

function monthRange(month: string) {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last };
}

const COLUMNS: [keyof Close, string][] = [
  ["sold", "Vendido"],
  ["cost", "Custo"],
  ["fixedShare", "Custo fixo"],
  ["result", "Resultado"],
];

export function DailyCloseScreen({ bookId }: { bookId: string }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const list = useList(listDailyCloses, bookId, monthRange(month));
  const items = list.items as unknown as Close[] | null;

  return (
    <section aria-label="Fechamento" className="space-y-4">
      <header className="flex items-end justify-between">
        <h1 className="text-lg font-semibold">Fechamento</h1>
        <TextField
          id="close-month"
          label="Mês (AAAA-MM)"
          value={month}
          onChange={(value) => /^\d{4}-\d{2}$/.test(value) && setMonth(value)}
        />
      </header>
      <p className="text-sm text-muted-foreground">
        Calculado a cada leitura, nunca guardado. Provisório enquanto o mês está
        aberto ou uma taxa de cartão ou vale ainda não é conhecida.
      </p>
      <ErrorNote text={list.error} />
      {items && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum dia lançado neste mês.
        </p>
      ) : null}
      {items && items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              {COLUMNS.map(([, label]) => (
                <TableHead key={label} className="text-right">
                  {label}
                </TableHead>
              ))}
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((close) => (
              <TableRow key={close.businessDate}>
                <TableCell>{close.businessDate}</TableCell>
                {COLUMNS.map(([field]) => (
                  <TableCell key={field} className="tabular text-right">
                    {formatStatementAmount(String(close[field]))}
                  </TableCell>
                ))}
                <TableCell className="space-x-1">
                  <Badge variant={close.provisional ? "outline" : "default"}>
                    {close.provisional ? "Provisório" : "Fechado"}
                  </Badge>
                  {close.missingCost.length > 0 ? (
                    <Badge variant="outline">
                      {close.missingCost.length} sem custo
                    </Badge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}
