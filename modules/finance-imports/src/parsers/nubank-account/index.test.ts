/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNubankAccount } from ".";
import { ImportFormatError } from "../read";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("Nubank account statement", () => {
  const [incoming, invoice, outgoing] = parseNubankAccount(
    fixture("month.csv"),
  );

  test("reads the signed amount as minor units, never through a float", () => {
    expect(incoming?.amount).toBe(16500n);
    expect(invoice?.amount).toBe(-16450n);
    expect(outgoing?.amount).toBe(-136401n);
  });

  test("a date is a UTC day with no invented instant", () => {
    expect(incoming?.occurredOn.toISOString()).toBe("2026-01-06T00:00:00.000Z");
    expect(incoming?.occurredAt).toBeNull();
  });

  test("Identificador identifies the line", () => {
    expect(outgoing?.externalId).toBe("00000000-0000-4000-8000-000000000003");
  });

  test("the name is the description as printed; nothing is taken out of it", () => {
    expect(outgoing?.name).toBe(outgoing?.description);
    expect(outgoing?.name).toContain("FORNECEDOR EXEMPLO");
    expect(invoice?.name).toBe("Pagamento de fatura");
  });

  test("refuses another format, a shifted line and a blank id", () => {
    expect(() => parseNubankAccount("a,b\n1,2")).toThrow(ImportFormatError);
    expect(() => parseNubankAccount(fixture("malformed.csv"))).toThrow(
      "expected 4 fields, found 5",
    );
    expect(() =>
      parseNubankAccount(
        "Data,Valor,Identificador,Descrição\n06/01/2026,1.00,,x",
      ),
    ).toThrow("Identificador is required");
    expect(() =>
      parseNubankAccount("Data,Valor,Identificador,Descrição\n"),
    ).toThrow("no lines");
  });
});
