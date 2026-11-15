"use client";

/**
 * A read-only list: one list operation, its columns, an optional filter
 * input. For screens that only show what the ledger holds.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OperationDescriptor } from "@lastro/kernel";
import type { ReactNode } from "react";
import { ErrorNote, type Row, useList } from "./forms";

export type ListColumn = {
  readonly header: string;
  readonly numeric?: boolean;
  readonly cell: (row: Row) => ReactNode;
};

export function ListScreen(props: {
  bookId: string;
  title: string;
  description?: string;
  list: OperationDescriptor;
  input?: Record<string, unknown>;
  columns: readonly ListColumn[];
  emptyText: string;
}) {
  const rows = useList(props.list, props.bookId, {
    limit: 100,
    ...props.input,
  });
  return (
    <section aria-label={props.title} className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{props.title}</h1>
        {props.description ? (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </header>
      <ErrorNote text={rows.error} />
      {rows.items && rows.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.emptyText}</p>
      ) : null}
      {rows.items && rows.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              {props.columns.map((column) => (
                <TableHead
                  key={column.header}
                  className={column.numeric ? "text-right" : undefined}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.items.map((row) => (
              <TableRow key={row.id}>
                {props.columns.map((column) => (
                  <TableCell
                    key={column.header}
                    className={
                      column.numeric ? "tabular text-right" : undefined
                    }
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}
