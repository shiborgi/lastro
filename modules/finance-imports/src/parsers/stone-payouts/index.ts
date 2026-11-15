/**
 * Stone's payout report (docs/flows/stone-payouts.md): one row per deposit of
 * one mode and brand into the business's bank account.
 *
 * Semicolon-delimited. `Identificador Rastreável do Pagamento` is Stone's id
 * for the deposit, the movement's external id; `Valor` is what is deposited,
 * in reais with a comma, on `Data de Vencimento`. Every row is Stone's
 * promise (ADR 20), paid (`Pago`) or still scheduled (`PaymentScheduled`):
 * the money is only in once the bank line shows it. The name is the mode and
 * brand as printed; nothing is extracted from it (ADR 16).
 */
import type { AccountMovementObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, parseBrazilianDate, readCsvTable } from "../read";

const COLUMNS = [
  "Valor",
  "Bandeira",
  "Modalidade",
  "Identificador Rastreável do Pagamento",
  "Data de Vencimento",
] as const;

/* `2283,01` or `1.589,31` → minor units, read as digits. */
function money(value: string): bigint {
  const match = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(value.trim());
  if (!match) throw new ImportFormatError(`Valor is not an amount: "${value}"`);
  const [, whole = "0", cents = "00"] = match;
  return BigInt(`${whole.replace(/\./g, "")}${cents}`);
}

export function parseStonePayouts(
  content: string,
): readonly AccountMovementObservation[] {
  return readCsvTable(content, {
    label: "Stone payout report",
    delimiter: ";",
    columns: COLUMNS,
    row: (cell, line): AccountMovementObservation => {
      const externalId = cell.text("Identificador Rastreável do Pagamento");
      if (!externalId)
        throw new ImportFormatError(
          "Identificador Rastreável do Pagamento is required",
        );
      const amount = money(cell.text("Valor"));
      if (amount === 0n) throw new ImportFormatError("Valor is zero");
      return {
        externalId,
        line,
        occurredOn: parseBrazilianDate(
          cell.text("Data de Vencimento"),
          "Data de Vencimento",
        ),
        occurredAt: null,
        // A deposit is money in: positive.
        amount,
        currency: "BRL",
        name: [cell.text("Modalidade"), cell.text("Bandeira")]
          .filter(Boolean)
          .join(" "),
        description: line,
        promise: true,
      };
    },
  });
}

export const stonePayouts: MovementImporter = {
  id: "stone/payouts",
  version: 1,
  evidence: "receipt-movements",
  parse: parseStonePayouts,
};
