/**
 * C6 Bank's checking-account export (docs/flows/c6-account.md).
 *
 * Comma-delimited with quoting (RFC 4180), and five lines of prose before the
 * header, which is found by name. Two date columns (the movement's and the
 * accounting one) and separate in/out columns, one always 0.00. There is no
 * id per line: finance identifies it by the hash of its text.
 */
import type { AccountMovementObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, readCsvTable } from "../read";

const COLUMNS = [
  "Data Lançamento",
  "Data Contábil",
  "Título",
  "Descrição",
  "Entrada(R$)",
  "Saída(R$)",
  "Saldo do Dia(R$)",
] as const;

const IDENTITY_COLUMNS = COLUMNS.filter(
  (column) => column !== "Saldo do Dia(R$)",
);

export function parseC6Account(
  content: string,
): readonly AccountMovementObservation[] {
  return readCsvTable(content, {
    label: "C6 account statement",
    delimiter: ",",
    columns: COLUMNS,
    isHeader: (row) => row[0]?.trim() === COLUMNS[0],
    row: (cell): AccountMovementObservation => {
      const inflow = cell.money("Entrada(R$)");
      const outflow = cell.money("Saída(R$)");
      if (inflow !== 0n && outflow !== 0n)
        throw new ImportFormatError("a line has both an inflow and an outflow");
      const amount = inflow !== 0n ? inflow : -outflow;
      if (amount === 0n) throw new ImportFormatError("the line moves no money");
      const title = cell.optional("Título");
      const description = cell.text("Descrição");
      /*
       * Both fields name the counterparty: measured on a real export,
       * `Descrição` alone files four Pix recipients under one wording and
       * `Título` alone every card brand under one; together they separate
       * every counterparty and merge none. They are kept as printed.
       */
      const name = [title, description].filter(Boolean).join(" ");
      return {
        externalId: null,
        /*
         * The line's identity, without `Saldo do Dia`: the day's balance grows
         * as the day goes on, so an export taken mid-day would give the same
         * movement another hash. Two identical movements of one day are told
         * apart by finance's counter (`#2`).
         */
        line: IDENTITY_COLUMNS.map((column) => cell.text(column)).join(","),
        occurredOn: cell.date("Data Lançamento"),
        occurredAt: null,
        amount,
        currency: "BRL",
        name,
        description: name,
      };
    },
  });
}

export const c6Account: MovementImporter = {
  id: "c6/account",
  version: 1,
  evidence: "account-movements",
  parse: parseC6Account,
};
