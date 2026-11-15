/**
 * Yooga's payments report, as the agent writes it from the point of
 * sale's report (docs/flows/yooga-payments.md).
 *
 * Semicolon-delimited, one row per payment method of one operational day
 * ([06:00, next 06:00) America/Sao_Paulo), and a closing TOTAL row, which is
 * skipped: it repeats the others. `bruto` is the products sold, `valor` what
 * was paid: `bruto` − `desconto` + `acrescimo` (the service fee); finance
 * refuses a record that does not add up. The day is the `data` column. Both
 * columns are written by the agent; a file without them is refused.
 */
import type { RevenueObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, readCsvTable } from "../read";

const COLUMNS = [
  "data",
  "forma_pagamento",
  "quantidade",
  "bruto",
  "desconto",
  "acrescimo",
  "valor",
] as const;

function isoDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = match
    ? new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      )
    : null;
  if (!parsed || parsed.toISOString().slice(0, 10) !== value)
    throw new ImportFormatError(`data is not YYYY-MM-DD: "${value}"`);
  return parsed;
}

export function parseYoogaPayments(
  content: string,
): readonly RevenueObservation[] {
  const rows = readCsvTable(content, {
    label: "Yooga payments report",
    delimiter: ";",
    columns: COLUMNS,
    row: (cell): RevenueObservation | null => {
      const name = cell.text("forma_pagamento");
      // the agent has written TOTAL in either column; the row only sums the others.
      if (
        name.toUpperCase() === "TOTAL" ||
        cell.text("data").toUpperCase() === "TOTAL"
      )
        return null;
      if (!name) throw new ImportFormatError("forma_pagamento is required");
      const quantity = Number(cell.text("quantidade"));
      if (!Number.isInteger(quantity) || quantity < 0)
        throw new ImportFormatError("quantidade is not a count");
      const discount = cell.money("desconto");
      const fee = cell.money("acrescimo");
      if (discount < 0n || fee < 0n)
        throw new ImportFormatError("desconto and acrescimo are not negative");
      return {
        occurredOn: isoDay(cell.text("data")),
        name,
        quantity,
        gross: cell.money("bruto"),
        amount: cell.money("valor"),
        discount,
        fee,
        acquirerFee: 0n,
        grossRecognized: true,
        currency: "BRL",
      };
    },
  });
  const records = rows.filter((row): row is RevenueObservation => row !== null);
  if (records.length === 0)
    throw new ImportFormatError("not a Yooga payments report: no records");
  return records;
}

export const yoogaPayments: MovementImporter = {
  id: "yooga/payments",
  version: 1,
  evidence: "revenue-movements",
  parse: parseYoogaPayments,
};
