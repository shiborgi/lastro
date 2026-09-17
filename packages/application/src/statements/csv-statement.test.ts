/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { defineCsvStatement } from "./csv-statement";
import { StatementFormatError } from "./types";

/*
 * The ceremony every bank plugin used to carry its own copy of. It is worth a
 * test of its own precisely because it is now shared: a regression here is a
 * regression in every bank at once, and each of these guards exists because of
 * a way a real file goes wrong.
 */

const plugin = defineCsvStatement({
  id: "probe/conta",
  institutionKey: "probe",
  kind: "account",
  label: "Probe account statement",
  delimiter: ",",
  columns: ["Data", "Valor", "Descrição"],
  row: (cell) => ({
    purchaseDate: cell.date("Data"),
    description: cell.text("Descrição"),
    amount: cell.money("Valor"),
    currency: "BRL",
  }),
});

const HEADER = "Data,Valor,Descrição";

describe("the shared CSV ceremony", () => {
  test("reads a well-formed file", () => {
    const parsed = plugin.parse(`${HEADER}\n10/08/2026,-98.27,BANCO C6 S.A.`);
    expect(parsed.kind).toBe("account");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.amount).toBe(-9827n);
  });

  test("refuses a file with no rows, naming what it expected", () => {
    expect(() => plugin.parse(HEADER)).toThrow(StatementFormatError);
    expect(() => plugin.parse(HEADER)).toThrow(
      "Probe account statement has no rows",
    );
  });

  /*
   * The check that separates "wrong file in the folder" from a crash halfway
   * through, and names the columns so the operator can see it is the C6 export
   * sitting in the Nubank folder.
   */
  test("refuses a file whose columns are not this bank's", () => {
    expect(() =>
      plugin.parse("Date,Amount,Memo\n2026-08-10,-98.27,ACME"),
    ).toThrow("not a Probe account statement: missing column(s) Data, Valor");
  });

  /*
   * The field-count check is the only thing standing between an unquoted
   * delimiter inside a description and every later column shifting by one. Its
   * whole value is the line number, so the wrapper has to carry it through.
   */
  test("keeps the line number when a row has the wrong field count", () => {
    expect(() =>
      plugin.parse(
        `${HEADER}\n10/08/2026,-98.27,OK\n11/08/2026,-1.00,BAD,EXTRA`,
      ),
    ).toThrow(/line 3/);
  });

  test("names the column when a cell cannot be read", () => {
    expect(() => plugin.parse(`${HEADER}\n2026-08-10,-98.27,BANCO`)).toThrow(
      'Data is not DD/MM/YYYY: "2026-08-10"',
    );
  });

  test("treats an empty cell and a dash alike, as absent", () => {
    const dashes = defineCsvStatement({
      id: "probe/conta2",
      institutionKey: "probe",
      kind: "account",
      label: "Probe",
      delimiter: ",",
      columns: ["Data", "Valor", "Descrição", "Título"],
      row: (cell) => ({
        purchaseDate: cell.date("Data"),
        description: cell.text("Descrição"),
        title: cell.optional("Título"),
        amount: cell.money("Valor"),
        currency: "BRL",
      }),
    });
    const parsed = dashes.parse(
      `${HEADER},Título\n10/08/2026,-98.27,A,-\n11/08/2026,-1.00,B,`,
    );
    expect(parsed.rows[0]?.title).toBeUndefined();
    expect(parsed.rows[1]?.title).toBeUndefined();
  });

  /*
   * Both defaults matter. A plugin that declares no floor must not inherit one
   * from its statement kind — that inheritance is what this refactor removed.
   */
  test("declares no method floor and no own rules unless asked", () => {
    expect(plugin.methodFloor).toBeNull();
    expect(plugin.methodRules).toEqual([]);
  });

  test("carries a declared floor onto the plugin", () => {
    const card = defineCsvStatement({
      id: "probe/cartao",
      institutionKey: "probe",
      kind: "card",
      label: "Probe invoice",
      delimiter: ";",
      columns: ["Data", "Valor", "Descrição"],
      methodFloor: "CREDIT_CARD",
      row: (cell) => ({
        purchaseDate: cell.date("Data"),
        description: cell.text("Descrição"),
        amount: cell.money("Valor"),
        currency: "BRL",
      }),
    });
    expect(card.methodFloor).toBe("CREDIT_CARD");
    // And the narrow parse type survives: a card statement, not the union.
    expect(card.parse("Data;Valor;Descrição\n10/08/2026;12.00;X").kind).toBe(
      "card",
    );
  });
});
