/**
 * C6 Bank exports: the card invoice and the checking-account statement.
 *
 * Two files from one bank that agree on almost nothing — different delimiter,
 * different quoting, one with a preamble, one date against two, one signed
 * amount against separate in/out columns. Hence two plugins rather than one
 * with branches.
 *
 * Everything below is a fact about these two files. The CSV reading, the
 * column check and the error wrapping live in `defineCsvStatement`.
 */
import { defineCsvStatement } from "./csv-statement";
import { StatementFormatError, type StatementHeader } from "./types";

const CARD_COLUMNS = [
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

const ACCOUNT_COLUMNS = [
  "Data Lançamento",
  "Data Contábil",
  "Título",
  "Descrição",
  "Entrada(R$)",
  "Saída(R$)",
  "Saldo do Dia(R$)",
] as const;

/**
 * `3/3` → number 3 of 3. `Única` (and anything unparsable) means the charge is
 * whole, so neither field is set — the same as a purchase this statement
 * never marks as financed at all.
 */
function parseInstallment(raw: string | undefined): {
  installmentNumber?: number;
  installmentCount?: number;
} {
  if (!raw) return {};
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (!match) return {};
  return {
    installmentNumber: Number(match[1]),
    installmentCount: Number(match[2]),
  };
}

export const c6Card = defineCsvStatement({
  id: "c6/cartao",
  institutionKey: "c6",
  kind: "card",
  label: "C6 card statement",
  // Semicolon-delimited and entirely unquoted, so the reader's field-count
  // check is the only thing standing between a description containing ";" and
  // every later column shifting by one.
  delimiter: ";",
  columns: CARD_COLUMNS,
  /*
   * Every purchase on a credit-card invoice is a credit-card purchase — that
   * is what the document is, not something inferred from its wording. The text
   * still wins where it disagrees: "Pag Fatura Boleto" is the payment *of* the
   * invoice, by boleto, and the floor would get that one wrong.
   */
  methodFloor: "CREDIT_CARD",
  row: (cell) => ({
    purchaseDate: cell.date("Data de Compra"),
    cardholder: cell.optional("Nome no Cartão"),
    cardNumber: cell.optional("Final do Cartão"),
    category: cell.optional("Categoria"),
    description: cell.text("Descrição"),
    ...parseInstallment(cell.optional("Parcela")),
    // The two USD columns are 0 on domestic charges; the BRL column is the
    // amount actually billed either way, so it is the one that counts.
    amount: cell.money("Valor (em R$)"),
    currency: "BRL",
  }),
});

/**
 * The preamble carries what the rows do not: which account this is and what
 * period it covers. Read leniently — a missing line costs the row a nullable
 * column, and refusing the whole file over a header the bank reworded would be
 * worse than importing without it.
 */
function parseAccountHeader(content: string): StatementHeader {
  const header: StatementHeader = {};
  const account = /Ag[êe]ncia:\s*(\S+)\s*\/\s*Conta:\s*(\S+)/i.exec(content);
  if (account) {
    header.branch = account[1];
    header.accountNumber = account[2];
  }
  return header;
}

export const c6Account = defineCsvStatement({
  id: "c6/conta",
  institutionKey: "c6",
  kind: "account",
  label: "C6 account statement",
  // Comma-delimited WITH quoting, so this one genuinely needs RFC 4180.
  delimiter: ",",
  columns: ACCOUNT_COLUMNS,
  // The header is found by name because the file opens with five lines of
  // prose; taking the first non-blank row would pick up the title.
  isHeader: (row) => row[0]?.trim() === ACCOUNT_COLUMNS[0],
  header: parseAccountHeader,
  /*
   * C6's own column values, which no other bank prints. `Título` carries the
   * transaction type on a card settlement line, and it is the only place the
   * card's function appears.
   */
  methodRules: [
    {
      pattern: /CART\.?\s*DEBIT|CRED\s+LOJ\s+C\s+DEBITO/,
      method: "DEBIT_CARD",
    },
    {
      pattern: /CART\.?\s*CREDIT|CRED\s+LOJ\s+C\s+CREDITO/,
      method: "CREDIT_CARD",
    },
  ],
  row: (cell) => {
    // Two columns, one always 0.00. Collapsed into a signed amount, with out
    // negative — the sign is what makes a total meaningful.
    const inflow = cell.money("Entrada(R$)");
    const outflow = cell.money("Saída(R$)");
    if (inflow !== 0n && outflow !== 0n) {
      throw new StatementFormatError(
        `row has both an inflow and an outflow: "${cell.text("Descrição")}"`,
      );
    }
    const title = cell.optional("Título");
    const description = cell.text("Descrição");
    return {
      purchaseDate: cell.date("Data Lançamento"),
      title,
      description,
      /*
       * Both fields, because on this statement neither alone says who was on
       * the other side. Measured on a real 139-line export: `Descrição` alone
       * files four different Pix recipients under one "TRANSF ENVIADA PIX";
       * `Título` alone files every card brand under one "CRED LOJ C DEBITO".
       * Together they separate all 33 real counterparties and merge none.
       * Splitting one party in two costs a second mapping; merging two books
       * money against the wrong party.
       */
      counterparty: [title, description].filter(Boolean).join(" "),
      amount: inflow !== 0n ? inflow : -outflow,
      currency: "BRL",
    };
  },
});
