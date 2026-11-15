/**
 * What every statement parser shares: reading a CSV table by its column names,
 * Brazilian dates and decimal amounts, each refusal naming the line.
 *
 * Restored from `v1-horizontal:packages/application/src/statements/csv-statement.ts`
 * and `types.ts`. What stays out: identity, deduplication and meaning, which are
 * finance's (ADR 13).
 */
import { ImportFormatError } from "@lastro/kernel";
import { CsvError, parseCsvRecords } from "./csv";

export { ImportFormatError };

/** `DD/MM/YYYY`, as a UTC date so it never shifts a day by timezone. */
export function parseBrazilianDate(value: string, field: string): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match)
    throw new ImportFormatError(`${field} is not DD/MM/YYYY: "${value}"`);
  const [, day, month, year] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  )
    throw new ImportFormatError(
      `${field} is not a valid calendar date: "${value}"`,
    );
  return parsed;
}

/**
 * `716.66` → `71666n`, read as digits: `716.66 * 100` is `71665.99999999999`
 * as a float, and money that rounds is money that is wrong.
 */
export function parseDecimalToMinor(value: string, field: string): bigint {
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new ImportFormatError(`${field} is not a decimal amount: "${value}"`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  return BigInt(`${sign}${whole}${`${fraction}00`.slice(0, 2)}`);
}

/** One row's cells by column name; the name appears once per read. */
export type Cells = {
  text(name: string): string;
  /** Trimmed, with `""` and `-`, how these exports write empty, as null. */
  optional(name: string): string | null;
  date(name: string): Date;
  money(name: string): bigint;
};

function cellsFor(record: Record<string, string>): Cells {
  const text = (name: string) => {
    const value = record[name];
    if (value === undefined)
      throw new ImportFormatError(`missing column "${name}"`);
    return value.trim();
  };
  return {
    text,
    optional: (name) => {
      const value = record[name]?.trim();
      return value && value !== "-" ? value : null;
    },
    date: (name) => parseBrazilianDate(text(name), name),
    money: (name) => parseDecimalToMinor(text(name), name),
  };
}

/**
 * Parse a CSV export into rows: refuses a file with another header, a line
 * with another field count, or no lines, naming the line; then maps each row,
 * prefixing any refusal with its data row number.
 */
export function readCsvTable<Row>(
  content: string,
  spec: {
    label: string;
    delimiter: string;
    columns: readonly string[];
    isHeader?: (row: string[]) => boolean;
    /** `line` is the row's text, its fields rejoined by the delimiter. */
    row: (cells: Cells, line: string) => Row;
  },
): Row[] {
  let records: Record<string, string>[];
  try {
    records = parseCsvRecords(content.replace(/^﻿/, ""), spec.delimiter, {
      isHeader: spec.isHeader,
    });
  } catch (error) {
    if (error instanceof CsvError)
      throw new ImportFormatError(
        `not a ${spec.label}: line ${error.line}: ${error.message}`,
      );
    throw error;
  }
  const [first] = records;
  if (!first) throw new ImportFormatError(`not a ${spec.label}: no lines`);
  const missing = spec.columns.filter((column) => !(column in first));
  if (missing.length)
    throw new ImportFormatError(
      `not a ${spec.label}: missing column(s) ${missing.map((c) => `"${c}"`).join(", ")}`,
    );
  return records.map((record, index) => {
    try {
      return spec.row(
        cellsFor(record),
        Object.values(record).join(spec.delimiter),
      );
    } catch (error) {
      if (error instanceof ImportFormatError)
        throw new ImportFormatError(`row ${index + 1}: ${error.message}`);
      throw error;
    }
  });
}
