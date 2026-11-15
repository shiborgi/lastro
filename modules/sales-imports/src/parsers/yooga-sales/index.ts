/**
 * Yooga's sales report by product, as the agent writes it
 * (docs/flows/yooga-sales.md).
 *
 * Comma-delimited with quoting, dot decimals, one row per product sold in one
 * operational day: `data_inicio` is 06:00 of the day and `data_fim` 06:00 of
 * the next, America/Sao_Paulo. A file without them, or covering anything but
 * one operational day, is refused. `faturamento` is what the product sold
 * for, `custo` its total cost; `lucro_bruto` and `margem_pct` are derived
 * and not read.
 */
import { ImportFormatError } from "@lastro/kernel";
import type { SaleObservation } from "@lastro/sales";
import type { SaleImporter } from "../../application/importer";
import { CsvError, parseCsvRecords } from "../csv";

const COLUMNS = [
  "codigo",
  "produto",
  "categoria",
  "quantidade",
  "custo",
  "faturamento",
  "data_inicio",
  "data_fim",
] as const;

/* `1625.40` → 162540n, read as digits, never through a float. */
function minor(value: string, field: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new ImportFormatError(`${field} is not an amount: "${value}"`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  return BigInt(`${sign}${whole}${fraction.padEnd(2, "0")}`);
}

function quantity(value: string): string {
  const text = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text) || /^0+(\.0+)?$/.test(text))
    throw new ImportFormatError(
      `quantidade is not a positive count: "${value}"`,
    );
  return text;
}

/* `2026-11-01 06:00` and `2026-11-02 06:00` → the operational day 2026-11-01. */
function operationalDay(start: string, end: string): Date {
  const pattern = /^(\d{4}-\d{2}-\d{2}) 06:00$/;
  const from = pattern.exec(start.trim())?.[1];
  const to = pattern.exec(end.trim())?.[1];
  const day = from ? new Date(`${from}T00:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime()) || !to)
    throw new ImportFormatError(
      `data_inicio and data_fim are not YYYY-MM-DD 06:00: "${start}", "${end}"`,
    );
  const next = new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (to !== next)
    throw new ImportFormatError(
      `the report covers ${start} to ${end}, not one operational day`,
    );
  return day;
}

export function parseYoogaSales(content: string): readonly SaleObservation[] {
  let records: Record<string, string>[];
  try {
    records = parseCsvRecords(content.replace(/^﻿/, ""), ",");
  } catch (error) {
    if (error instanceof CsvError)
      throw new ImportFormatError(
        `not a Yooga sales report: line ${error.line}: ${error.message}`,
      );
    throw error;
  }
  const [first] = records;
  if (!first)
    throw new ImportFormatError("not a Yooga sales report: no products");
  const missing = COLUMNS.filter((column) => !(column in first));
  if (missing.length)
    throw new ImportFormatError(
      `not a Yooga sales report: missing column(s) ${missing.map((c) => `"${c}"`).join(", ")}`,
    );
  return records.map((record, index) => {
    const cell = (name: (typeof COLUMNS)[number]) =>
      (record[name] ?? "").trim();
    try {
      const name = cell("produto");
      if (!name) throw new ImportFormatError("produto is required");
      const cost = cell("custo");
      return {
        line: Object.values(record).join(","),
        occurredOn: operationalDay(cell("data_inicio"), cell("data_fim")),
        code: cell("codigo") || null,
        name,
        providerCategory: cell("categoria") || null,
        quantity: quantity(cell("quantidade")),
        revenue: minor(cell("faturamento"), "faturamento"),
        cost: cost ? minor(cost, "custo") : null,
        currency: "BRL",
      };
    } catch (error) {
      if (error instanceof ImportFormatError)
        throw new ImportFormatError(`row ${index + 1}: ${error.message}`);
      throw error;
    }
  });
}

export const yoogaSales: SaleImporter = {
  id: "yooga/sales",
  version: 1,
  evidence: "sale-movements",
  parse: parseYoogaSales,
};
