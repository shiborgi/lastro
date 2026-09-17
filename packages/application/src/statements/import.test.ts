/**
 * Staging: the point where dedup is decided.
 *
 * The property under test is the one the real files forced: re-importing a
 * statement must add nothing, while two genuinely identical charges must both
 * survive. A hash alone gets the first and loses the second.
 */
import { describe, expect, test } from "bun:test";

import { c6Account, c6Card } from "./c6";
import { cardMovementKey, descriptorKey, stageStatement } from "./import";

const CARD_CSV = [
  "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)",
  "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
  "15/08/2026;MARCOS WADA;8520;Supermercados;PAPON MINI - MERCADO E;Única;0;0;12.00",
  "16/06/2026;GELAGOELA B E R LTDA;3169;Materiais;MP *LKSOLUCOESVIDRACA;3/3;0;0;716.66",
].join("\n");

const IDS = { institutionId: "1", accountId: "1" };
const stageCard = (csv = CARD_CSV) =>
  stageStatement(c6Card, c6Card.parse(csv), IDS);

describe("occurrence", () => {
  /*
   * The real statement contains these two lines byte for byte: two R$12
   * purchases at one shop on one day. They are two charges, R$24 in total, and
   * a content hash alone would silently discard one.
   */
  test("numbers identical rows so both survive", () => {
    const rows = stageCard().card;
    expect(rows[0]?.key).toBe(rows[1]?.key ?? "");
    expect(rows[0]?.occurrence).toBe(1);
    expect(rows[1]?.occurrence).toBe(2);
  });

  test("numbers each distinct row from 1", () => {
    expect(stageCard().card[2]?.occurrence).toBe(1);
  });

  /*
   * Counting within the file, rather than against what is stored, is what
   * makes a re-import a no-op: the same bytes always produce the same
   * (key, occurrence) pairs, which the unique index then rejects.
   */
  test("is stable across runs, so re-importing collides by design", () => {
    const first = stageCard().card.map((row) => `${row.key}#${row.occurrence}`);
    const second = stageCard().card.map(
      (row) => `${row.key}#${row.occurrence}`,
    );
    expect(second).toEqual(first);
  });
});

describe("key", () => {
  /*
   * Only the fields a real-time notification and the eventual statement line
   * can both be expected to carry: date, the descriptor the description
   * normalises to, and the amount. A card number or an installment marker —
   * things a notification never has — deliberately do not move the key.
   */
  test("changes when the date, descriptor, or amount changes", () => {
    const base = c6Card.parse(CARD_CSV).rows[0];
    if (!base) throw new Error("fixture row missing");
    const key = cardMovementKey("c6", "1", base);
    expect(cardMovementKey("c6", "1", { ...base, amount: 1201n })).not.toBe(
      key,
    );
    expect(
      cardMovementKey("c6", "1", { ...base, description: "OTHER" }),
    ).not.toBe(key);
  });

  test("ignores fields a real-time sighting would not have", () => {
    const base = c6Card.parse(CARD_CSV).rows[0];
    if (!base) throw new Error("fixture row missing");
    const key = cardMovementKey("c6", "1", base);
    expect(cardMovementKey("c6", "1", { ...base, cardNumber: "9999" })).toBe(
      key,
    );
    expect(cardMovementKey("c6", "1", { ...base, installmentNumber: 2 })).toBe(
      key,
    );
  });

  /*
   * Institution and account are inside the hash rather than in the unique
   * index. Two banks — or two accounts at the same bank — producing a
   * similar-looking line must not collide, and keeping it in the hash lets the
   * index stay `(book, key, occurrence)` — a NULL institution or account
   * column there would make every row distinct in Postgres and quietly
   * disable dedup.
   */
  test("separates two institutions that print the same line", () => {
    const row = c6Card.parse(CARD_CSV).rows[0];
    if (!row) throw new Error("fixture row missing");
    expect(cardMovementKey("c6", "1", row)).not.toBe(
      cardMovementKey("banco-x", "1", row),
    );
  });

  test("separates two accounts at the same institution", () => {
    const row = c6Card.parse(CARD_CSV).rows[0];
    if (!row) throw new Error("fixture row missing");
    expect(cardMovementKey("c6", "1", row)).not.toBe(
      cardMovementKey("c6", "2", row),
    );
  });
});

describe("alias key on the row", () => {
  /*
   * The row carries its own alias key so the link to `party_alias` is stored,
   * not recomputed. Recomputing it later would re-point rows that have already
   * been reviewed the moment the normalisation changes.
   */
  test("every staged row names the alias it belongs to", () => {
    const rows = stageCard().card;
    expect(rows[0]?.descriptorKey).toBe("papon_mini_-_mercado_e");
    expect(rows[2]?.descriptorKey).toBe("mp_*lksolucoesvidraca");
    expect(rows.every((row) => row.descriptorKey.length > 0)).toBe(true);
  });

  /*
   * The descriptors the import creates and the keys its rows point at must be
   * the same set — otherwise a movement references a descriptor that was never
   * inserted, and the foreign key rejects the whole import.
   */
  test("the descriptors created cover exactly the keys the rows carry", () => {
    const staged = stageCard();
    expect(
      [...new Set(staged.card.map((row) => row.descriptorKey))].sort(),
    ).toEqual([...staged.cardDescriptors].sort());
  });

  /*
   * A card statement contributes no account descriptor and the other way
   * round. The two tables are separate, so a row landing in the wrong set
   * would be a foreign-key failure on the whole import.
   */
  test("each statement kind fills only its own descriptor set", () => {
    const card = stageCard();
    expect(card.accountDescriptors).toEqual([]);
    const csv = [
      "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
      "10/08/2026,10/08/2026,T,BANCO C6 S.A.,0.00,9827.29,59.42",
    ].join("\n");
    expect(
      stageStatement(c6Account, c6Account.parse(csv), IDS).cardDescriptors,
    ).toEqual([]);
  });

  test("account rows carry one too", () => {
    const csv = [
      "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
      "10/08/2026,10/08/2026,T,BANCO C6 S.A.,0.00,9827.29,59.42",
    ].join("\n");
    const staged = stageStatement(c6Account, c6Account.parse(csv), IDS);
    // Title and description together — see the counterparty comment in c6.ts.
    expect(staged.account[0]?.descriptorKey).toBe("t_banco_c6_s.a.");
    expect(staged.accountDescriptors.map((d) => d.key)).toEqual([
      "t_banco_c6_s.a.",
    ]);
  });

  /*
   * The case that decided the rule, taken from a real 139-line C6 export.
   *
   * Four Pix to four different recipients all print `Descrição` as "TRANSF
   * ENVIADA PIX" — the recipient is only in `Título`. Keyed on the description
   * alone these are one alias, and mapping it points twenty movements at
   * whichever party happened to be chosen. Money against the wrong party is the
   * failure this whole staging step exists to prevent.
   */
  test("separates Pix recipients that share one description", () => {
    const csv = [
      "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
      "11/08/2026,11/08/2026,Pix enviado para GELAGOELA BAR E RESTAURANTE,TRANSF ENVIADA PIX,0.00,100.00,10.00",
      "12/08/2026,12/08/2026,Pix enviado para CEF MATRIZ,TRANSF ENVIADA PIX,0.00,200.00,10.00",
      "13/08/2026,13/08/2026,Pix enviado para NUTRICAO EM FOCO LTDA,TRANSF ENVIADA PIX,0.00,300.00,10.00",
      "14/08/2026,14/08/2026,Pix enviado para ANDRE ASSESSORIA CONTABIL LTDA,TRANSF ENVIADA PIX,0.00,400.00,10.00",
    ].join("\n");
    const staged = stageStatement(c6Account, c6Account.parse(csv), IDS);
    expect(new Set(staged.account.map((row) => row.description)).size).toBe(1);
    expect(staged.accountDescriptors.map((d) => d.key)).toHaveLength(4);
  });

  /*
   * The mirror case: `Título` alone is a transaction type on card settlements,
   * so keying on it would file every brand under "CRED LOJ C DEBITO" while the
   * acquirer that actually paid sits in the description.
   */
  test("separates card acquirers that share one title", () => {
    const csv = [
      "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
      "11/08/2026,11/08/2026,CRED LOJ C DEBITO,CART. DEBIT - Stone Pagamento - Maestro,100.00,0.00,10.00",
      "12/08/2026,12/08/2026,CRED LOJ C DEBITO,CART. DEBIT - Stone Pagamento - Visa Ele,200.00,0.00,10.00",
    ].join("\n");
    const staged = stageStatement(c6Account, c6Account.parse(csv), IDS);
    expect(new Set(staged.account.map((row) => row.title)).size).toBe(1);
    expect(staged.accountDescriptors.map((d) => d.key)).toHaveLength(2);
  });
});

describe("what the import records for later mapping", () => {
  test("collects each card once, with the holder it was printed under", () => {
    expect(stageCard().cards).toEqual([
      { cardNumber: "8520", cardholder: "MARCOS WADA" },
      { cardNumber: "3169", cardholder: "GELAGOELA B E R LTDA" },
    ]);
  });

  test("collects merchant descriptions, deduplicated", () => {
    expect([...stageCard().cardDescriptors].sort()).toEqual([
      "mp_*lksolucoesvidraca",
      "papon_mini_-_mercado_e",
    ]);
  });

  test("an account statement offers no card to map", () => {
    const csv = [
      "Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)",
      "10/08/2026,10/08/2026,T,BANCO C6 S.A.,0.00,9827.29,59.42",
    ].join("\n");
    const staged = stageStatement(c6Account, c6Account.parse(csv), IDS);
    expect(staged.cards).toEqual([]);
    expect(staged.account).toHaveLength(1);
  });
});

describe("descriptor key", () => {
  test("lowercases and joins on underscores, and nothing else", () => {
    expect(descriptorKey("PAPON MINI - MERCADO E")).toBe(
      "papon_mini_-_mercado_e",
    );
    // The acquirer prefix survives on purpose: stripping it would merge shops
    // that merely look alike once cleaned, and unmerging parties later costs
    // far more than mapping one alias twice.
    expect(descriptorKey("MP *LKSOLUCOESVIDRACA")).toBe(
      "mp_*lksolucoesvidraca",
    );
  });

  test("collapses runs of whitespace so spacing noise is not a new merchant", () => {
    expect(descriptorKey("  A   B  ")).toBe("a_b");
  });
});
