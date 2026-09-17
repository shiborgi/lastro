import type { PaymentMethod } from "@lastro/domain";
/**
 * The shape a CSV bank export plugin is written in.
 *
 * Every plugin here was doing the same twenty-five lines before its own work
 * started: parse the CSV, translate a `CsvError` into a `StatementFormatError`
 * carrying the line number, refuse an empty file, check the expected columns,
 * then map rows. Three plugins, three copies, and a fourth bank would have
 * copied it again — which is how one of them ends up with a slightly different
 * error message, or forgets the column check and shifts a column silently.
 *
 * `defineCsvStatement` holds that ceremony so a plugin file contains only what
 * is true about one institution's file: its delimiter, its column names, where
 * its table starts, and how to read one line.
 *
 * What deliberately stays out: anything about identity or meaning. `key` and
 * `occurrence` are the import's to compute (see `types.ts`), and a plugin never
 * decides that a charge is an expense (ADR 8).
 */
import { CsvError, parseCsvRecords } from "./csv";
import type { MethodRule } from "./method";
import {
  type AccountStatement,
  type AccountStatementRow,
  type CardStatement,
  type CardStatementRow,
  type ParsedStatement,
  StatementFormatError,
  type StatementHeader,
  type StatementKind,
  type StatementPlugin,
  parseBrazilianDate,
  parseDecimalToMinor,
} from "./types";

/**
 * One row's cells, read by column name.
 *
 * The name appears once per read. Going through `parseBrazilianDate(field(r,
 * "Data Contábil"), "Data Contábil")` spelled it twice, and the second one is
 * only ever used in an error message — so a typo there produced an error naming
 * a column that does not exist, about a column that does.
 */
export interface Cells {
  /** Required, trimmed. Throws if the column is missing. */
  text(name: string): string;
  /** Trimmed, with `""` and `-` — how these exports write empty — as absent. */
  optional(name: string): string | undefined;
  date(name: string): Date;
  optionalDate(name: string): Date | undefined;
  /** Decimal to minor units, never through a float. */
  money(name: string): bigint;
  optionalMoney(name: string): bigint | undefined;
  /** The record itself, for a bank that needs something none of these cover. */
  raw: Record<string, string>;
}

function cellsFor(record: Record<string, string>): Cells {
  const text = (name: string): string => {
    const value = record[name];
    if (value === undefined) {
      throw new StatementFormatError(`missing column "${name}"`);
    }
    return value.trim();
  };
  const optional = (name: string): string | undefined => {
    const value = record[name]?.trim();
    return value && value !== "-" ? value : undefined;
  };
  return {
    text,
    optional,
    date: (name) => parseBrazilianDate(text(name), name),
    optionalDate: (name) =>
      optional(name) === undefined
        ? undefined
        : parseBrazilianDate(text(name), name),
    money: (name) => parseDecimalToMinor(text(name), name),
    optionalMoney: (name) =>
      optional(name) === undefined
        ? undefined
        : parseDecimalToMinor(text(name), name),
    raw: record,
  };
}

interface CsvStatementSpec<Kind extends StatementKind, Row> {
  /** `<institution>/<kind>`, matching the storage layout. */
  id: string;
  institutionKey: string;
  kind: Kind;
  /** What this file is, used verbatim in the "not a …" error. */
  label: string;
  delimiter: string;
  /** Columns the mapper relies on. Their absence is what "not this file" means. */
  columns: readonly string[];
  /** Where the table starts, for a file that opens with prose. */
  isHeader?: (row: string[]) => boolean;
  /** Statement-level facts recovered from the preamble, read from raw text. */
  header?: (content: string) => StatementHeader;
  /**
   * The rail every line of this document took, before any wording is read.
   *
   * A property of the plugin, not of the statement kind: "a card invoice means
   * credit card" is true of *this* invoice, and a prepaid or debit-card export
   * registered under the same kind would be labelled wrong by a shared rule.
   */
  methodFloor?: PaymentMethod | null;
  /**
   * Wording only this institution prints, tried before the shared vocabulary.
   * `CRED LOJ C DEBITO` is a C6 column value, not Brazilian banking in general.
   */
  methodRules?: readonly MethodRule[];
  row: (cell: Cells) => Row;
}

export type CardStatementSpec = CsvStatementSpec<"card", CardStatementRow>;
export type AccountStatementSpec = CsvStatementSpec<
  "account",
  AccountStatementRow
>;

/**
 * A plugin whose `parse` is narrowed to the statement it actually returns.
 *
 * The registry is happy with the union, but a caller holding `c6Card` should
 * get `CardStatement` back — reading `cardNumber` off it is not a mistake.
 * Returning the bare union made every such read a type error and would have
 * pushed callers into casts.
 */
export interface CardStatementPlugin extends StatementPlugin {
  kind: "card";
  parse: (content: string) => CardStatement;
}

export interface AccountStatementPlugin extends StatementPlugin {
  kind: "account";
  parse: (content: string) => AccountStatement;
}

/** A CSV plugin from the facts about one file. See the module comment. */
export function defineCsvStatement(
  spec: CardStatementSpec,
): CardStatementPlugin;
export function defineCsvStatement(
  spec: AccountStatementSpec,
): AccountStatementPlugin;
export function defineCsvStatement(
  spec: CardStatementSpec | AccountStatementSpec,
): StatementPlugin {
  return {
    id: spec.id,
    institutionKey: spec.institutionKey,
    kind: spec.kind,
    methodFloor: spec.methodFloor ?? null,
    methodRules: spec.methodRules ?? [],
    parse(content: string): ParsedStatement {
      let records: Record<string, string>[];
      try {
        records = parseCsvRecords(
          content,
          spec.delimiter,
          spec.isHeader ? { isHeader: spec.isHeader } : undefined,
        );
      } catch (err) {
        // The line number is the whole value of the reader's field-count check;
        // losing it here would turn "line 41: 8 fields, expected 7" into
        // "malformed file".
        if (err instanceof CsvError) {
          throw new StatementFormatError(`line ${err.line}: ${err.message}`);
        }
        throw err;
      }

      const first = records[0];
      if (!first) {
        throw new StatementFormatError(`${spec.label} has no rows`);
      }
      const missing = spec.columns.filter((name) => !(name in first));
      if (missing.length > 0) {
        throw new StatementFormatError(
          `not a ${spec.label}: missing column(s) ${missing.join(", ")}`,
        );
      }

      const header = spec.header ? spec.header(content) : {};
      /*
       * The two branches differ only in the row type, which TypeScript cannot
       * narrow through a shared mapper — so the discriminant is applied here
       * once rather than by every plugin.
       */
      return spec.kind === "card"
        ? {
            kind: "card",
            header,
            rows: records.map((r) => spec.row(cellsFor(r))),
          }
        : {
            kind: "account",
            header,
            rows: records.map((r) => spec.row(cellsFor(r))),
          };
    },
  };
}
