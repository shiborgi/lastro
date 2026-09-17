/**
 * Nubank's checking-account export.
 *
 * The simplest file this ledger reads: four columns, no preamble, no quoting,
 * one already-signed amount. `Identificador` prints a UUID per transaction,
 * but the ledger does not read it — a hash of the row's own content is what
 * every plugin dedupes on, so a real-time sighting of a purchase and its
 * eventual statement line can be reconciled the same way regardless of bank.
 *
 * There is no card export here yet. The file that prompted this plugin sits in
 * `nubank/conta/` and its contents are Pix transfers plus a card bill payment,
 * so it exercises the account model; the invoice model is still only C6's.
 */
import { defineCsvStatement } from "./csv-statement";

const ACCOUNT_COLUMNS = [
  "Data",
  "Valor",
  "Identificador",
  "Descrição",
] as const;

export const nubankAccount = defineCsvStatement({
  id: "nubank/conta",
  institutionKey: "nubank",
  kind: "account",
  label: "Nubank account statement",
  /*
   * Unquoted, and the descriptions contain commas — "Transferência enviada
   * pelo Pix - NAME - •••.384.536-•• - BANK (0341) Agência: 3321 Conta:
   * 18578-1" has none, but the acquirer lines do. The reader's field-count
   * check is what turns a future comma into a named error rather than a silent
   * column shift.
   */
  delimiter: ",",
  columns: ACCOUNT_COLUMNS,
  /*
   * No preamble to read. The period and account number are only in the file
   * NAME (`NU_441776988_01JAN2026_31JAN2026.csv`), and a file name is
   * something anyone can rename. Reading account identity out of it would make
   * a rename silently relabel someone's money.
   */
  row: (cell) => {
    const description = cell.text("Descrição");
    return {
      purchaseDate: cell.date("Data"),
      description,
      // The whole line names the counterparty here, unlike C6 where it is
      // split across two columns, so there is nothing to combine.
      counterparty: description,
      // One signed column: negative is money out, which already matches this
      // table's convention. Nothing to collapse.
      amount: cell.money("Valor"),
      currency: "BRL",
    };
  },
});
