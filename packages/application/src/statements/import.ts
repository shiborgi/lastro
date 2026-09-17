/**
 * Turning a parsed statement into staged movements.
 *
 * This is where dedup lives, and it lives here rather than in a plugin or a
 * caller so that every route into the ledger agrees on when two rows are the
 * same row. A plugin computing its own key would let one caller's idea of
 * "already imported" differ from another's, and the failure would look like
 * missing money.
 *
 * Nothing here decides what a line *means*. Rows land as PENDING, the card
 * numbers and merchant descriptions the import has never seen are recorded
 * without a destination, and a person or an agent maps them afterwards
 * (ADR 8).
 */
import { createHash } from "node:crypto";

import type { PaymentMethod } from "@lastro/domain";
import { inferPaymentMethod } from "./method";
import type {
  AccountStatementRow,
  CardStatementRow,
  ParsedStatement,
  StatementHeader,
  StatementPlugin,
} from "./types";

/**
 * The merchant description as an alias key: lowercase, spaces to underscores,
 * nothing else.
 *
 * Deliberately minimal. Stripping acquirer prefixes (`MP *`, `PG *`) would
 * group variants of one shop, but it also merges shops that only look alike
 * after cleaning — and unmerging two parties later is far more work than
 * mapping one alias twice.
 */
export function descriptorKey(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Stable across processes and machines, unlike any hash of an object. */
function hashFields(
  parts: (string | number | bigint | null | undefined)[],
): string {
  // A separator that cannot occur in the fields, so ["a","bc"] and ["ab","c"]
  // cannot collide into the same digest.
  const payload = parts
    .map((part) => (part == null ? "" : String(part)))
    .join("\u0000");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Number identical rows 1, 2, 3… in the order they appear in the file.
 *
 * This is the half of dedup that keeps real money visible. The genuine
 * statement contains two byte-identical lines — two R$12 purchases at the same
 * shop on the same day — and with the hash alone the second would be discarded
 * as a duplicate of the first. Counting within the file, and not against what
 * is already stored, is what also makes a re-import a no-op: the same file
 * always produces the same numbering.
 */
function withOccurrence<
  T extends { description: string; counterparty?: string; title?: string },
>(
  rows: T[],
  keyOf: (row: T) => string,
): (T & { key: string; occurrence: number; descriptorKey: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = keyOf(row);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    // Normalised here, once, and stored on the row. The descriptor a movement
    // belongs to is a fact about the import that made it, not something to
    // recompute later from a function that may since have changed.
    return {
      ...row,
      key,
      occurrence,
      descriptorKey: descriptorKey(row.counterparty ?? row.description),
    };
  });
}

/**
 * What makes two movement rows the same row.
 *
 * Institution and account first, so the same descriptor text at two different
 * banks — or two accounts at the same bank — cannot collide. Then the
 * purchase date, the descriptor the row normalises to, and the amount: the
 * fields a real-time notification and the eventual statement line can both be
 * expected to agree on, unlike a raw description the bank may reword, an
 * installment marker a notification never carries, or a card number that
 * names the plastic rather than the purchase.
 */
function movementKey(
  institutionId: string,
  accountId: string,
  row: {
    purchaseDate: Date;
    description: string;
    counterparty?: string;
    amount: bigint;
  },
): string {
  return hashFields([
    institutionId,
    accountId,
    row.purchaseDate.toISOString().slice(0, 10),
    descriptorKey(row.counterparty ?? row.description),
    row.amount,
  ]);
}

export function cardMovementKey(
  institutionId: string,
  accountId: string,
  row: CardStatementRow,
): string {
  return movementKey(institutionId, accountId, row);
}

export function accountMovementKey(
  institutionId: string,
  accountId: string,
  row: AccountStatementRow,
): string {
  return movementKey(institutionId, accountId, row);
}

export interface StagedCardMovement extends CardStatementRow {
  key: string;
  occurrence: number;
  /** `description` normalised — the row's join to `card_descriptors`. */
  descriptorKey: string;
}

export interface StagedAccountMovement extends AccountStatementRow {
  key: string;
  occurrence: number;
  /** `description` normalised — the row's join to `account_descriptors`. */
  descriptorKey: string;
}

export interface StagedStatement {
  kind: "card" | "account";
  header: StatementHeader;
  card: StagedCardMovement[];
  account: StagedAccountMovement[];
  /** Card numbers seen in this file, each with the holder it was printed under. */
  cards: { cardNumber: string; cardholder?: string }[];
  /**
   * The distinct descriptors this file named.
   *
   * A card statement contributes keys only: every line on a credit-card invoice
   * was paid by that card, so there is no method to infer and none is stored.
   * An account statement contributes a method too, where its own text implies
   * one — a null method means the file did not say, and those are the ones a
   * person has to decide.
   */
  cardDescriptors: string[];
  accountDescriptors: { key: string; method: PaymentMethod | null }[];
}

/**
 * The distinct descriptors in an account statement, each with the method its
 * text implies.
 *
 * Derived from the staged rows rather than recomputed, so the keys the import
 * creates and the keys the rows point at are the same set by construction — a
 * movement referencing a descriptor that was never inserted is rejected by the
 * foreign key, taking the whole import with it.
 *
 * First occurrence wins. A descriptor is one string; two rows sharing it cannot
 * imply different methods, and picking the first avoids an arbitrary overwrite.
 */
function accountDescriptorsFor(
  rows: { descriptorKey: string; title?: string; description: string }[],
  plugin: StatementPlugin,
): { key: string; method: PaymentMethod | null }[] {
  const seen = new Map<string, PaymentMethod | null>();
  for (const row of rows) {
    if (seen.has(row.descriptorKey)) continue;
    seen.set(
      row.descriptorKey,
      /*
       * The institution's own wording first, then the shared vocabulary, then
       * whatever the document establishes on its own. Both of the first two
       * come from the plugin, because both are facts about one bank's file.
       */
      inferPaymentMethod([row.title, row.description], plugin.methodRules) ??
        plugin.methodFloor,
    );
  }
  return [...seen].map(([key, method]) => ({ key, method }));
}

/** The distinct descriptors in a card statement. See above for why keys only. */
function cardDescriptorsFor(rows: { descriptorKey: string }[]): string[] {
  return [...new Set(rows.map((row) => row.descriptorKey))];
}

/**
 * Attach `key` and `occurrence` to every row, and collect what to map later.
 *
 * Takes the plugin rather than its key: the descriptors it builds need the
 * institution's own method wording and the rail its document establishes, and
 * both are declared by the plugin. Passing a bare string also allowed staging
 * one bank's rows under another bank's key.
 *
 * `ids` are the institution and account the caller already resolved against
 * the Book — not the plugin's own `institutionKey` — because the movement key
 * needs the same identity a real-time sighting of the same purchase would
 * resolve to, and a plugin only knows its own text constant, never a Book's
 * row ids.
 */
export function stageStatement(
  plugin: StatementPlugin,
  statement: ParsedStatement,
  ids: { institutionId: string; accountId: string },
): StagedStatement {
  if (statement.kind === "card") {
    const card = withOccurrence(statement.rows, (row) =>
      cardMovementKey(ids.institutionId, ids.accountId, row),
    );
    // First holder wins: the same card is printed under one name throughout a
    // statement, and picking the first avoids an arbitrary later overwrite.
    const cards = new Map<
      string,
      { cardNumber: string; cardholder?: string }
    >();
    for (const row of statement.rows) {
      if (row.cardNumber && !cards.has(row.cardNumber)) {
        cards.set(row.cardNumber, {
          cardNumber: row.cardNumber,
          cardholder: row.cardholder,
        });
      }
    }
    return {
      kind: "card",
      header: statement.header,
      card,
      account: [],
      cards: [...cards.values()],
      // Taken from the staged rows, not recomputed: the descriptors the import
      // creates and the keys the rows carry have to be the same set, and
      // deriving one from the other is what makes that true by construction.
      cardDescriptors: cardDescriptorsFor(card),
      accountDescriptors: [],
    };
  }

  const account = withOccurrence(statement.rows, (row) =>
    accountMovementKey(ids.institutionId, ids.accountId, row),
  );
  return {
    kind: "account",
    header: statement.header,
    card: [],
    account,
    // An account statement prints no card, so there is nothing to map here.
    cards: [],
    cardDescriptors: [],
    accountDescriptors: accountDescriptorsFor(account, plugin),
  };
}
