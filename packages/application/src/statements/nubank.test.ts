/**
 * The Nubank account plugin, driven with excerpts of the real export.
 *
 * Every fixture line below was copied from a genuine
 * `NU_441776988_01JAN2026_31JAN2026.csv`, masked only where it named a person.
 */
import { describe, expect, test } from "bun:test";

import { accountMovementKey, stageStatement } from "./import";
import { resolveStatementPlugin } from "./index";
import { nubankAccount } from "./nubank";
import { StatementFormatError } from "./types";

const CSV = [
  "Data,Valor,Identificador,Descrição",
  "06/01/2026,165.00,695d6e17-581b-4fc0-b802-3763df212f87,Transferência recebida pelo Pix - GELAGOELA BAR E RESTAURANTE LTDA - 52.580.995/0001-00 - BCO C6 S.A. (0336) Agência: 1 Conta: 29507685-2",
  "06/01/2026,-164.50,695d6e4a-5d89-44c6-962c-04df3a000a4d,Pagamento de fatura",
  "07/01/2026,-1364.01,695e85f4-a477-47cd-926c-474933c18c28,Transferência enviada pelo Pix - FULANO DE TAL - •••.384.536-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 3321 Conta: 18578-1",
].join("\n");

const parsed = nubankAccount.parse(CSV);

describe("Nubank account statement", () => {
  test("reads the single signed amount without touching a float", () => {
    expect(parsed.rows[0]?.amount).toBe(16500n);
    expect(parsed.rows[2]?.amount).toBe(-136401n);
  });

  /*
   * C6 splits money in and money out across two columns; Nubank signs one. The
   * convention this table stores — positive in, negative out — is already what
   * the file uses, so there is nothing to collapse and nothing to flip.
   */
  test("keeps the sign the file already uses", () => {
    expect(parsed.rows[1]?.amount).toBeLessThan(0n);
    expect(parsed.rows[0]?.amount).toBeGreaterThan(0n);
  });

  test("parses the date as UTC, so it cannot shift a day by timezone", () => {
    expect(parsed.rows[0]?.purchaseDate.toISOString()).toBe(
      "2026-01-06T00:00:00.000Z",
    );
  });

  /*
   * No title, no category, and no account number: the file simply does not
   * have them. They are nullable columns for exactly this — and the empty
   * header is why `accountId` has to be stated at import rather than read
   * from the file.
   */
  test("leaves absent columns absent rather than inventing them", () => {
    expect(parsed.rows[0]?.title).toBeUndefined();
    expect(parsed.rows[0]?.category).toBeUndefined();
    expect(parsed.header).toEqual({});
  });

  test("rejects a file whose columns are not this format", () => {
    expect(() => nubankAccount.parse("a,b\n1,2")).toThrow(StatementFormatError);
  });

  test("resolves from its storage path", () => {
    expect(
      resolveStatementPlugin("nubank/conta/NU_441776988.csv").plugin.id,
    ).toBe("nubank/conta");
  });
});

describe("dedup by content, same as every other plugin", () => {
  const IDS = { institutionId: "1", accountId: "1" };

  /*
   * No bank-issued id here, so a reworded counterparty is a different hash —
   * the trade-off the removal of `externalId` accepted, in exchange for one
   * dedup rule that works the same whether the sighting is this file or a
   * real-time notification arriving before it. `counterparty` is what the key
   * actually reads for this plugin (the whole line names it), so that is the
   * field a rewording has to change.
   */
  test("the key changes when the counterparty changes", () => {
    const row = parsed.rows[0];
    if (!row) throw new Error("fixture row missing");
    expect(
      accountMovementKey("nubank", "1", {
        ...row,
        counterparty: "REWORDED BY BANK",
      }),
    ).not.toBe(accountMovementKey("nubank", "1", row));
  });

  test("two different transactions never share a key", () => {
    const [first, , third] = parsed.rows;
    if (!first || !third) throw new Error("fixture rows missing");
    expect(accountMovementKey("nubank", "1", first)).not.toBe(
      accountMovementKey("nubank", "1", third),
    );
  });

  /*
   * Two banks (or two accounts) printing an otherwise identical line must not
   * collide, so institution and account both stay inside the hash.
   */
  test("separates two institutions printing the same line", () => {
    const row = parsed.rows[0];
    if (!row) throw new Error("fixture row missing");
    expect(accountMovementKey("nubank", "1", row)).not.toBe(
      accountMovementKey("outro-banco", "1", row),
    );
  });

  test("separates two accounts at the same institution", () => {
    const row = parsed.rows[0];
    if (!row) throw new Error("fixture row missing");
    expect(accountMovementKey("nubank", "1", row)).not.toBe(
      accountMovementKey("nubank", "2", row),
    );
  });

  test("every occurrence is 1, and re-importing is a no-op", () => {
    const staged = stageStatement(nubankAccount, parsed, IDS);
    expect(staged.account.map((row) => row.occurrence)).toEqual([1, 1, 1]);
    const again = stageStatement(nubankAccount, nubankAccount.parse(CSV), IDS);
    expect(again.account.map((row) => `${row.key}#${row.occurrence}`)).toEqual(
      staged.account.map((row) => `${row.key}#${row.occurrence}`),
    );
  });
});

describe("what the Nubank import records for later mapping", () => {
  /*
   * The whole description names the counterparty here, so it is the alias key
   * on its own — unlike C6, where the recipient is in a separate column.
   */
  const IDS = { institutionId: "1", accountId: "1" };

  test("one descriptor per counterparty", () => {
    const staged = stageStatement(nubankAccount, parsed, IDS);
    expect(staged.accountDescriptors.map((d) => d.key)).toHaveLength(3);
    expect(staged.accountDescriptors.map((d) => d.key)).toContain(
      "pagamento_de_fatura",
    );
  });

  test("an account statement offers no card to map", () => {
    expect(stageStatement(nubankAccount, parsed, IDS).cards).toEqual([]);
  });
});
