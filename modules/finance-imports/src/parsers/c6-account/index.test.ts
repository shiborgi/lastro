/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseC6Account } from ".";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

describe("C6 account statement", () => {
  const [pix, credit, debit, invoice, first, second] = parseC6Account(
    fixture("month.csv"),
  );

  test("skips the preamble and folds in/out into one signed amount", () => {
    expect(pix?.amount).toBe(-16500n);
    expect(credit?.amount).toBe(11203n);
    expect(invoice?.amount).toBe(-98273n);
  });

  test("has no provider id: finance identifies a line by its text", () => {
    expect(pix?.externalId).toBeNull();
    expect(pix?.line).toContain("TRANSF ENVIADA PIX");
    expect(first?.line).toBe(second?.line);
  });

  test("the day's balance is not part of a line's identity", () => {
    const later = fixture("month.csv").replace(
      "0.00,45.00,976.33",
      "0.00,45.00,900.00",
    );
    const [, , , , moved] = parseC6Account(later);
    expect(moved?.line).toBe(first?.line);
    expect(first?.line).not.toContain("976.33");
  });

  test("the name is both fields as printed", () => {
    expect(pix?.name).toBe(
      "Pix enviado para EMPRESA EXEMPLO LTDA TRANSF ENVIADA PIX",
    );
    expect(debit?.name).toBe(
      "CRED LOJ C DEBITO CART. DEBIT - Stone Pagamento, Maestro",
    );
    expect(invoice?.name).toBe("BANCO C6 S.A. BANCO C6 S.A.");
    // Nothing is read from the wording but the name: the descriptor decides.
    expect(pix).not.toHaveProperty("method");
  });

  test("refuses a line with both an inflow and an outflow", () => {
    expect(() => parseC6Account(fixture("both.csv"))).toThrow(
      "both an inflow and an outflow",
    );
  });
});
