/**
 * The C6 plugins, driven with excerpts of the real exports.
 *
 * Every fixture line here was copied from a genuine file — with one deliberate
 * exception noted at its test — because the failures worth guarding are the
 * ones invented samples do not have: an amount split across two columns, an
 * installment of a purchase made five months before the statement, a bill
 * payment that is not a purchase, and two byte-identical rows.
 */
import { describe, expect, test } from "bun:test";

import { c6Account, c6Card } from "./c6";
import { parseCsvRecords } from "./csv";
import { parseStatementPath, resolveStatementPlugin } from "./index";
import { StatementFormatError } from "./types";

const CARD_CSV = [
  "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
  "16/06/2026;GELAGOELA B E R LTDA;3169;Materiais de construção para casa;MP *LKSOLUCOESVIDRACA;3/3;0;0;716.66",
  "10/08/2026;GELAGOELA B E R LTDA;3169;-;Pag Fatura Boleto;Única;0;0;-9827.29",
  "18/04/2026;MARCOS WADA;8520;Educacional;EBAC*-*ESCOLA*BRITANIC;5/12;0;0;362.08",
  "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
  "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
].join("\n");

const ACCOUNT_CSV = [
  "EXTRATO DE CONTA CORRENTE C6 BANK",
  "",
  "Agência: 1 / Conta: 295076852",
  "Extrato gerado em 08/09/2026 - as 20:32:54",
  "",
  "Extrato de 09/08/2026 a 08/09/2026",
  "",
  "",
  "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
  "10/08/2026,10/08/2026,CRED LOJ C CREDITO,CART. CREDIT - Stone Pagamento - Masterc,112.03,0.00,59.42",
  '10/08/2026,10/08/2026,CRED LOJ C DEBITO,"CART. DEBIT - Stone Pagamento, Maestro ",937.03,0.00,59.42',
  "10/08/2026,10/08/2026,BANCO C6 S.A.,BANCO C6 S.A.,0.00,9827.29,59.42",
].join("\n");

describe("C6 card statement", () => {
  const rows = c6Card.parse(CARD_CSV).rows;

  test("reads amounts as minor units without touching a float", () => {
    // 716.66 * 100 is 71665.99999999999 in binary floating point; money that
    // rounds is money that is wrong.
    expect(rows[0]?.amount).toBe(71666n);
    expect(rows[3]?.amount).toBe(1200n);
  });

  test("keeps the sign, so a bill payment is not read as a purchase", () => {
    expect(rows[1]?.amount).toBe(-982729n);
    expect(rows[1]?.description).toBe("Pag Fatura Boleto");
  });

  test("splits an installment marker into its number and count", () => {
    expect(rows[0]).toMatchObject({
      installmentNumber: 3,
      installmentCount: 3,
    });
    expect(rows[2]).toMatchObject({
      installmentNumber: 5,
      installmentCount: 12,
    });
  });

  test("treats 'Única' as whole: neither field is set", () => {
    expect(rows[1]?.installmentNumber).toBeUndefined();
    expect(rows[1]?.installmentCount).toBeUndefined();
  });

  test("reads '-' as an absent category, not the string '-'", () => {
    expect(rows[1]?.category).toBeUndefined();
    expect(rows[0]?.category).toBe("Materiais de construção para casa");
  });

  test("parses the date as UTC, so it cannot shift a day by timezone", () => {
    expect(rows[0]?.purchaseDate.toISOString()).toBe(
      "2026-06-16T00:00:00.000Z",
    );
  });

  /*
   * The purchase date is months before the statement — this row is instalment
   * 5 of 12 of an April purchase. Anything deriving a reference month from
   * this date would scatter one invoice across the year.
   */
  test("keeps the purchase date, not a statement date", () => {
    expect(rows[2]?.purchaseDate.toISOString()).toBe(
      "2026-04-18T00:00:00.000Z",
    );
  });

  test("keeps two byte-identical rows as two rows", () => {
    expect(rows[3]).toEqual(rows[4]);
    expect(rows).toHaveLength(5);
  });

  test("rejects a file whose columns are not this format", () => {
    expect(() => c6Card.parse("a;b\n1;2")).toThrow(StatementFormatError);
  });

  /*
   * The card export quotes nothing, so a description containing ";" produces
   * an extra field and every later column shifts. The count check turns that
   * into a named error instead of an amount read out of the wrong column.
   */
  test("refuses a row with the wrong field count, naming the line", () => {
    const broken = `${CARD_CSV}\n01/09/2026;X;1;-;A;B;C;Única;0;0;1.00`;
    expect(() => c6Card.parse(broken)).toThrow(/line 7/);
  });
});

describe("C6 account statement", () => {
  const statement = c6Account.parse(ACCOUNT_CSV);

  /*
   * The real export quotes 30 rows, for trailing whitespace rather than commas;
   * a naive split would leave literal quote characters in those descriptions.
   * A delimiter inside quotes is rarer but legal, and there a split shifts every
   * later column — so the fixture carries the harder case on purpose.
   */
  test("keeps a quoted field containing a comma intact", () => {
    expect(statement.rows[1]?.description).toBe(
      "CART. DEBIT - Stone Pagamento, Maestro",
    );
  });

  test("collapses the in/out pair into a signed amount", () => {
    expect(statement.rows[0]?.amount).toBe(11203n);
    expect(statement.rows[2]?.amount).toBe(-982729n);
  });

  /*
   * Branch and account number only. The period left the schema when the two
   * movement tables converged, and which account a row belongs to is now
   * `account_id`, stated at import — these two are kept as what the statement
   * printed, evidence beside the identity rather than the identity itself.
   */
  test("recovers the account the statement printed, from the preamble", () => {
    expect(statement.header.branch).toBe("1");
    expect(statement.header.accountNumber).toBe("295076852");
  });

  test("skips the preamble without counting it as data", () => {
    expect(statement.rows).toHaveLength(3);
  });

  /*
   * The card's "Pag Fatura Boleto" of -9827.29 and this statement's outflow of
   * 9827.29 are the same event seen from two sides. Both must survive parsing
   * with their own sign, because the promotion step tells them apart.
   */
  test("the bill payment reconciles with the card statement", () => {
    const fromAccount = statement.rows[2]?.amount;
    const fromCard = c6Card.parse(CARD_CSV).rows[1]?.amount;
    expect(fromAccount).toBe(fromCard);
  });

  test("refuses a row claiming both an inflow and an outflow", () => {
    const bad = ACCOUNT_CSV.replace("112.03,0.00,59.42", "112.03,50.00,59.42");
    expect(() => c6Account.parse(bad)).toThrow(/both an inflow and an outflow/);
  });
});

describe("path resolution", () => {
  test("reads institution and kind from the storage layout", () => {
    expect(parseStatementPath("c6/cartao/Fatura_2026-09-10.csv")).toEqual({
      institutionKey: "c6",
      kind: "cartao",
      fileName: "Fatura_2026-09-10.csv",
    });
  });

  test("resolves each plugin from its path", () => {
    expect(resolveStatementPlugin("c6/cartao/f.csv").plugin.id).toBe(
      "c6/cartao",
    );
    expect(resolveStatementPlugin("c6/conta/f.csv").plugin.id).toBe("c6/conta");
  });

  test("names what is registered when a path matches nothing", () => {
    // The operator who put the file in `cards/` needs to be told the tree uses
    // `cartao/`, not merely that this is unsupported.
    expect(() => resolveStatementPlugin("c6/cards/f.csv")).toThrow(
      /known: c6\/cartao, c6\/conta/,
    );
  });

  test("rejects a path without the two directory levels", () => {
    expect(() => parseStatementPath("Fatura.csv")).toThrow(
      StatementFormatError,
    );
  });
});

describe("csv reader", () => {
  test("handles escaped quotes and newlines inside a quoted field", () => {
    const records = parseCsvRecords('a,b\n"x""y","line1\nline2"', ",");
    expect(records[0]).toEqual({ a: 'x"y', b: "line1\nline2" });
  });

  test("reads a last row that has no trailing newline", () => {
    expect(parseCsvRecords("a,b\n1,2", ",")).toHaveLength(1);
  });
});
