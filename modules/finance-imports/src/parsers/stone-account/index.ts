/**
 * Stone's account statement (docs/flows/stone-account.md).
 *
 * Comma-delimited with quoting, one header row, newest first. Two kinds of
 * line are read:
 * - the Pix the account sends to other accounts (`Débito`, `Pix`, `Enviado`),
 *   one movement each, identified by the hash of its text;
 * - the Pix sales it receives (`Crédito`, `Transação`, `FINISHED`), each
 *   credited net of Stone's fee (`Valor` − `Tarifa`), summed per day into one
 *   money-in movement: what Stone's sales record of that day's Pix nets to
 *   (ADR 20). Its identity is the day, so a later export with more sales of
 *   that day is refused rather than counted twice.
 * Every other line is skipped.
 */
import type { AccountMovementObservation } from "@lastro/finance";
import type { MovementImporter } from "../../application/importer";
import { ImportFormatError, readCsvTable } from "../read";

const COLUMNS = [
  "Movimentação",
  "Tipo",
  "Valor",
  "Saldo antes",
  "Saldo depois",
  "Tarifa",
  "Data",
  "Horário",
  "Situação",
  "Destino",
  "Destino Instituição",
] as const;

/* `-3.009,75` or `R$ 3.009,75` → minor units, read as digits. */
function money(value: string, field: string): bigint {
  const match = /^(-?)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(
    value.trim(),
  );
  if (!match)
    throw new ImportFormatError(`${field} is not an amount: "${value}"`);
  const [, sign = "", whole = "0", cents = "00"] = match;
  return BigInt(`${sign}${whole.replace(/\./g, "")}${cents}`);
}

/* `09/11/2026 16:28` and `16:28:27.226`, São Paulo (UTC−3). */
function when(date: string, time: string): { at: Date; on: Date } {
  const day = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(date.trim());
  const clock = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(time.trim());
  if (!day || !clock)
    throw new ImportFormatError(`Data/Horário unreadable: "${date}" "${time}"`);
  const [d, m, y] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const [hh, mm, ss] = [Number(clock[1]), Number(clock[2]), Number(clock[3])];
  const ms = Number((clock[4] ?? "0").padEnd(3, "0"));
  return {
    at: new Date(Date.UTC(y, m - 1, d, hh + 3, mm, ss, ms)),
    on: new Date(Date.UTC(y, m - 1, d)),
  };
}

const SALES = "Transação";

export function parseStoneAccount(
  content: string,
): readonly AccountMovementObservation[] {
  const sales = new Map<string, { on: Date; net: bigint; count: number }>();
  const rows = readCsvTable(content, {
    label: "Stone account statement",
    delimiter: ",",
    columns: COLUMNS,
    row: (cell, line): AccountMovementObservation | null => {
      if (
        cell.text("Movimentação") === "Crédito" &&
        cell.text("Tipo") === SALES &&
        cell.text("Situação") === "FINISHED"
      ) {
        const gross = money(cell.text("Valor"), "Valor");
        const fee = cell.text("Tarifa");
        const net = gross - (fee === "Grátis" ? 0n : money(fee, "Tarifa"));
        const on = when(cell.text("Data"), cell.text("Horário")).on;
        const day = on.toISOString().slice(0, 10);
        const known = sales.get(day) ?? { on, net: 0n, count: 0 };
        sales.set(day, { on, net: known.net + net, count: known.count + 1 });
        return null;
      }
      if (
        cell.text("Movimentação") !== "Débito" ||
        cell.text("Tipo") !== "Pix" ||
        cell.text("Situação") !== "Enviado"
      )
        return null;
      const amount = money(cell.text("Valor"), "Valor");
      if (amount >= 0n)
        throw new ImportFormatError("a Pix sent is not negative");
      const fee = cell.text("Tarifa");
      if (fee !== "Grátis" && money(fee, "Tarifa") !== 0n)
        throw new ImportFormatError(
          "a Pix sent with a fee: its amount would not be what arrived",
        );
      const time = when(cell.text("Data"), cell.text("Horário"));
      // The destination as printed: who, and at which institution.
      const name = [
        cell.text("Tipo"),
        cell.text("Destino"),
        cell.text("Destino Instituição"),
      ]
        .filter(Boolean)
        .join(" ");
      return {
        externalId: null,
        line,
        occurredOn: time.on,
        occurredAt: time.at,
        amount,
        currency: "BRL",
        name,
        description: name,
      };
    },
  });
  const sent = rows.filter(
    (row): row is AccountMovementObservation => row !== null,
  );
  const received: AccountMovementObservation[] = [...sales.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { on, net, count }]) => ({
      externalId: null,
      line: `${day};${SALES}`,
      occurredOn: on,
      occurredAt: null,
      amount: net,
      currency: "BRL",
      name: SALES,
      description: `${count} ${SALES} ${day}`,
    }));
  if (sent.length + received.length === 0)
    throw new ImportFormatError(
      "not a Stone account statement with a Pix sent or a sale received",
    );
  return [...sent, ...received];
}

export const stoneAccount: MovementImporter = {
  id: "stone/account",
  version: 2,
  evidence: "account-movements",
  parse: parseStoneAccount,
};
