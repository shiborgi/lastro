/**
 * Stone's sales export, read as one record per day, product and brand
 * (docs/flows/stone-sales.md).
 *
 * Semicolon-delimited, one row per sale, amounts with six decimal places, a
 * comma and a thousands dot (`1.686,000000`). The approved sales of a day,
 * product and brand are summed with their six places and rounded once, half
 * up: the gross and what Stone keeps (MDR, anticipation, unified). Only
 * `Aprovada` is a captured sale.
 *
 * A record is a revenue movement (ADR 19). Its gross is what the point of
 * sale already recorded as paid, so it is not recognized again; only what
 * Stone keeps becomes a revenue, the acquirer's fee. The amount is the net
 * Stone will pay.
 */
import type { RevenueObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, readCsvTable } from "../read";

const COLUMNS = [
  "DATA DA VENDA",
  "BANDEIRA",
  "PRODUTO",
  "STONE ID",
  "VALOR BRUTO",
  "VALOR LIQUIDO",
  "DESCONTO DE MDR",
  "DESCONTO DE ANTECIPACAO",
  "DESCONTO UNIFICADO",
  "ULTIMO STATUS",
] as const;

/* `1.686,000000` → 1686000000 millionths, read as digits: never through a float. */
function micro(value: string, field: string): bigint {
  const match = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,6}))?$/.exec(
    value.trim() || "0",
  );
  if (!match)
    throw new ImportFormatError(`${field} is not an amount: "${value}"`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  return BigInt(`${sign}${whole.replace(/\./g, "")}${fraction.padEnd(6, "0")}`);
}

/* Millionths to minor units, half up. */
function toMinor(value: bigint): bigint {
  return (value + 5_000n) / 10_000n;
}

/* `08/11/2026 23:04` → the sale's day. */
function saleDay(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) \d{2}:\d{2}$/.exec(value.trim());
  if (!match)
    throw new ImportFormatError(
      `DATA DA VENDA is not DD/MM/YYYY HH:MM: "${value}"`,
    );
  return `${match[3]}-${match[2]}-${match[1]}`;
}

type Sale = { day: string; name: string; gross: bigint; discount: bigint };

export function parseStoneSales(
  content: string,
): readonly RevenueObservation[] {
  const sales = readCsvTable(content, {
    label: "Stone sales export",
    delimiter: ";",
    columns: COLUMNS,
    row: (cell): Sale | null => {
      if (cell.text("ULTIMO STATUS") !== "Aprovada") return null;
      const id = cell.text("STONE ID");
      const gross = micro(cell.text("VALOR BRUTO"), "VALOR BRUTO");
      const discounts =
        micro(cell.text("DESCONTO DE MDR"), "DESCONTO DE MDR") +
        micro(cell.text("DESCONTO DE ANTECIPACAO"), "DESCONTO DE ANTECIPACAO") +
        micro(cell.text("DESCONTO UNIFICADO"), "DESCONTO UNIFICADO");
      if (
        gross + discounts !==
        micro(cell.text("VALOR LIQUIDO"), "VALOR LIQUIDO")
      )
        throw new ImportFormatError(
          `sale ${id}: gross and discounts do not make the net`,
        );
      return {
        day: saleDay(cell.text("DATA DA VENDA")),
        // The product and brand as printed; Pix prints no brand.
        name: [cell.text("PRODUTO"), cell.text("BANDEIRA")]
          .filter(Boolean)
          .join(" "),
        gross,
        discount: -discounts,
      };
    },
  });
  const groups = new Map<string, Sale & { quantity: number }>();
  for (const sale of sales) {
    if (!sale) continue;
    const key = `${sale.day};${sale.name}`;
    const group = groups.get(key);
    if (group) {
      group.gross += sale.gross;
      group.discount += sale.discount;
      group.quantity += 1;
    } else groups.set(key, { ...sale, quantity: 1 });
  }
  if (groups.size === 0)
    throw new ImportFormatError("not a Stone sales export: no approved sale");
  return [...groups.values()].map((group) => {
    const gross = toMinor(group.gross);
    const discount = toMinor(group.discount);
    return {
      occurredOn: new Date(`${group.day}T00:00:00Z`),
      name: group.name,
      quantity: group.quantity,
      gross,
      discount: 0n,
      fee: 0n,
      acquirerFee: discount,
      grossRecognized: false,
      amount: gross - discount,
      currency: "BRL",
    };
  });
}

export const stoneSales: MovementImporter = {
  id: "stone/sales",
  version: 1,
  evidence: "revenue-movements",
  parse: parseStoneSales,
};
