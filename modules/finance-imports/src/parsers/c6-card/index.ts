/**
 * C6 Bank's card invoice export (docs/flows/c6-card.md).
 *
 * Semicolon-delimited and entirely unquoted, one header row, no preamble. A
 * line is one instalment of a purchase: the purchase date (never the
 * invoice's), `Parcela` `k/n` or `Única`, and the instalment's amount in
 * reais. Positive is a charge; negative a credit, such as the invoice paid
 * (`Pag Fatura Boleto`). There is no id per line: finance identifies it by
 * the hash of its text and derives the statement keys from what it says
 * (ADR 18).
 */
import type { CardObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, readCsvTable } from "../read";

const COLUMNS = [
  "Data de Compra",
  "Nome no Cartão",
  "Final do Cartão",
  "Categoria",
  "Descrição",
  "Parcela",
  "Valor (em US$)",
  "Cotação (em R$)",
  "Valor (em R$)",
] as const;

/* `3/3` is instalment 3 of 3; `Única` is a purchase paid whole. */
function installmentOf(raw: string | null): {
  installmentNumber: number;
  installmentCount: number;
} {
  if (!raw || /^[úu]nica$/i.test(raw))
    return { installmentNumber: 1, installmentCount: 1 };
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (!match) throw new ImportFormatError(`Parcela is not k/n: "${raw}"`);
  const installmentNumber = Number(match[1]);
  const installmentCount = Number(match[2]);
  if (
    installmentCount < 1 ||
    installmentNumber < 1 ||
    installmentNumber > installmentCount
  )
    throw new ImportFormatError(`Parcela is not k/n: "${raw}"`);
  return { installmentNumber, installmentCount };
}

export function parseC6Card(content: string): readonly CardObservation[] {
  return readCsvTable(content, {
    label: "C6 card invoice",
    // Unquoted: a ";" inside a description changes the field count, and the
    // reader refuses that line rather than shifting its columns.
    delimiter: ";",
    columns: COLUMNS,
    row: (cell, line): CardObservation => {
      const installment = installmentOf(cell.optional("Parcela"));
      // The same purchase on every invoice: the line with only the count of `Parcela`.
      const purchaseLine = COLUMNS.map((column) =>
        column === "Parcela"
          ? `/${installment.installmentCount}`
          : cell.text(column),
      ).join(";");
      const amount = cell.money("Valor (em R$)");
      if (amount === 0n) throw new ImportFormatError("Valor (em R$) is zero");
      const description = cell.text("Descrição");
      if (!description) throw new ImportFormatError("Descrição is required");
      return {
        line,
        purchaseLine,
        occurredOn: cell.date("Data de Compra"),
        // The BRL column is what is billed; the USD pair is 0 on domestic charges.
        amount,
        currency: "BRL",
        name: description,
        description,
        cardholder: cell.optional("Nome no Cartão"),
        cardLast4: cell.optional("Final do Cartão"),
        providerCategory: cell.optional("Categoria"),
        ...installment,
      };
    },
  });
}

export const c6Card: MovementImporter = {
  id: "c6/card",
  version: 1,
  evidence: "card-movements",
  parse: parseC6Card,
};
