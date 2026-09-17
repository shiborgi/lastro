/**
 * The one inference in the import, held to the data that justified it.
 *
 * Every string below was taken from a real C6 or Nubank export. The cases that
 * matter are the ones where a guess would be wrong: a supplier name that says
 * nothing about how it was paid, and a merchant whose name merely contains the
 * letters of a transfer type.
 */
import { describe, expect, test } from "bun:test";

import { c6Account } from "./c6";
import { inferPaymentMethod } from "./method";

describe("inferring the method", () => {
  test("reads the type a statement names", () => {
    expect(
      inferPaymentMethod(["Pix enviado para GELAGOELA", "TRANSF ENVIADA PIX"]),
    ).toBe("PIX");
    expect(
      inferPaymentMethod(["RECEBIMENTO DE TED", "69034668000156-PLUXEE"]),
    ).toBe("TRANSFER");
    expect(inferPaymentMethod([null, "Pag Fatura Boleto"])).toBe("BOLETO");
    expect(
      inferPaymentMethod([null, "Transferência enviada pelo Pix - FULANO"]),
    ).toBe("PIX");
  });

  /*
   * The whole reason this is a suggestion and not an answer. These lines name a
   * supplier and nothing else; the statement simply does not record how they
   * were paid. Returning a plausible method here would put a wrong fact on
   * someone's books, quietly.
   */
  test("returns null when the text names only a supplier", () => {
    for (const text of [
      "VIVO - GVT",
      "SIMPLES NACIONAL",
      "KARISMA IMOVEIS",
      "SINDICATO DOS EMPREGADOS NO COM",
      "CLINIPAR SERVICOS MEDICOS LTDA",
      "IOF CHEQUE ESPECIAL",
    ]) {
      expect(inferPaymentMethod([text, text])).toBeNull();
    }
  });

  /*
   * `"TED" in text` matches UNITED, LIMITED and CREDITED. None of the files in
   * hand contains such a merchant, which is why the guard has to be written
   * against the ones that will rather than against the sample.
   */
  test("does not mistake a merchant's letters for a transfer type", () => {
    for (const name of [
      "UNITED PARTS LTDA",
      "LIMITED EDITION STORE",
      "CREDITED SERVICOS",
      "PIXEL DESIGN STUDIO",
      "TOPIX COMERCIO",
    ]) {
      expect(inferPaymentMethod([name, name])).toBeNull();
    }
  });

  test("folds accents, because one file spells it both ways", () => {
    expect(
      inferPaymentMethod([null, "CART. DÉBITO - Stone"], c6Account.methodRules),
    ).toBe("DEBIT_CARD");
    expect(inferPaymentMethod([null, "Transferência recebida pelo PIX"])).toBe(
      "PIX",
    );
  });

  /*
   * The wording that belongs to one bank.
   *
   * `CRED LOJ C DEBITO` is a value C6 puts in its `Título` column, not Brazilian
   * banking vocabulary — it was sitting in the shared rule set, which meant
   * adding a bank required editing a list every other bank reads. The pair of
   * assertions is what keeps it moved: matched through the plugin's own rules,
   * unmatched without them.
   */
  describe("an institution's own wording", () => {
    test("classifies through that institution's plugin", () => {
      expect(
        inferPaymentMethod(
          ["CRED LOJ C DEBITO", "CART. DEBIT - Stone Pagamento - Maestro"],
          c6Account.methodRules,
        ),
      ).toBe("DEBIT_CARD");
      expect(
        inferPaymentMethod(
          ["CRED LOJ C CREDITO", "CART. CREDIT - Stone Pagamento - Visa Cr"],
          c6Account.methodRules,
        ),
      ).toBe("CREDIT_CARD");
    });

    test("is not in the shared vocabulary any more", () => {
      expect(
        inferPaymentMethod([
          "CRED LOJ C DEBITO",
          "CART. DEBIT - Stone Pagamento - Maestro",
        ]),
      ).toBeNull();
    });

    test("wins over the shared vocabulary, being the more specific claim", () => {
      // "PIX" would match the shared rule; the plugin's rule is tried first.
      expect(
        inferPaymentMethod(
          ["PIX", "CART. DEBIT"],
          [{ pattern: /CART\.?\s*DEBIT/, method: "DEBIT_CARD" }],
        ),
      ).toBe("DEBIT_CARD");
    });
  });

  test("an empty line implies nothing", () => {
    expect(inferPaymentMethod([null, ""])).toBeNull();
    expect(inferPaymentMethod([undefined, "   "])).toBeNull();
  });
});
