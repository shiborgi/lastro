"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatStatementAmount } from "@/lib/money";
import { ErrorNote, type Row, useList } from "@/shell/forms";
/**
 * Sales days: each day with posted sale lines, derived from them. Lines come
 * from imported sales (Vendas importadas), never typed here.
 */
import { listSalesDays } from "@lastro/sales/contracts";

export function SalesDaysScreen({ bookId }: { bookId: string }) {
  const list = useList(listSalesDays, bookId, {});

  return (
    <section aria-label="Dias de venda" className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dias de venda</h1>
      </header>
      <ErrorNote text={list.error} />
      {list.items && list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum dia lançado.</p>
      ) : null}
      {list.items && list.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead className="text-right">Vendido</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead>Sem custo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(
              list.items as unknown as (Row & {
                businessDate: string;
                missingCost: number;
              })[]
            ).map((day) => (
              <TableRow key={day.businessDate}>
                <TableCell>{day.businessDate}</TableCell>
                <TableCell className="tabular text-right">
                  {formatStatementAmount(String(day.revenue))}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatStatementAmount(String(day.cost))}
                </TableCell>
                <TableCell>
                  {day.missingCost > 0 ? `${day.missingCost} produto(s)` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}
