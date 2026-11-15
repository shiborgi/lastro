/**
 * Nubank's checking-account export (docs/flows/nubank-account.md).
 *
 * Four columns, no preamble, no quoting, one signed amount. `Identificador`
 * is Nubank's id for the movement and is what identifies a line: rewording a
 * description never makes it a new one. The file name carries the account
 * number and period, and is not read: anyone can rename a file.
 */
import type { AccountMovementObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, readCsvTable } from "../read";

const COLUMNS = ["Data", "Valor", "Identificador", "Descrição"] as const;

export function parseNubankAccount(
  content: string,
): readonly AccountMovementObservation[] {
  return readCsvTable(content, {
    label: "Nubank account statement",
    // Unquoted: a comma inside a description changes the field count, and the
    // reader refuses that line rather than shifting its columns.
    delimiter: ",",
    columns: COLUMNS,
    row: (cell, line): AccountMovementObservation => {
      const externalId = cell.text("Identificador");
      if (!externalId) throw new ImportFormatError("Identificador is required");
      const amount = cell.money("Valor");
      if (amount === 0n) throw new ImportFormatError("Valor is zero");
      const description = cell.text("Descrição");
      return {
        externalId,
        line,
        occurredOn: cell.date("Data"),
        occurredAt: null,
        amount,
        currency: "BRL",
        name: description,
        description,
      };
    },
  });
}

export const nubankAccount: MovementImporter = {
  id: "nubank/account",
  version: 1,
  evidence: "account-movements",
  parse: parseNubankAccount,
};
