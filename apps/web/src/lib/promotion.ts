/**
 * What can be promoted, grouped the way the decision was made.
 *
 * Promotion is one call per staged line, and the server is the authority on
 * whether it will accept one: it re-reads the descriptor, the sign and the
 * category on every call. This module answers the question the screen needs
 * *before* those calls — which lines would be accepted, and for the rest, why
 * not — by applying the same rules to data the API already serves.
 *
 * Two consequences of that being a mirror rather than the original. It has to
 * be kept honest against `postMovement`, which is what the tests here are for;
 * and it is never trusted over the server, so a refusal that arrives anyway is
 * shown with the server's own words rather than explained away.
 *
 * The unit is the descriptor, not the line. One wording stands for every line
 * that shares it, and the operator already made a single decision for all of
 * them at the review bench — so confirming that decision once is the work, and
 * a screen that asks per line asks the same question twenty-one times.
 */
import type { CatalogRecord, Movement } from "@/lib/api";

export type Side = "card" | "account";

/** What a promoted line becomes in the ledger. */
export type Becomes = "expense" | "revenue" | "transfer";

/**
 * Why a line is not promotable yet. Each is a different next action, which is
 * why they are separate values and not one "not ready" flag.
 */
export type Blocker =
  | "no-descriptor"
  | "no-party"
  | "no-category"
  | "wrong-kind"
  | "card-credit";

export type Verdict =
  | { ready: true; becomes: Becomes }
  | { ready: false; blocker: Blocker };

/** Only the fields the decision reads, so either descriptor table fits. */
type Descriptor = {
  partyId?: string | null;
  categoryId?: string | null;
  counterAccountId?: string | null;
};

type Category = { id: string; kind?: "EXPENSE" | "REVENUE" };

/**
 * The same order of checks as `postMovement`, and the order matters: a card
 * credit is refused before anything else, a transfer is decided before party
 * and category are looked at, and the kind is compared last.
 */
export function verdictFor(
  side: Side,
  amount: string,
  descriptor: Descriptor | undefined,
  categories: readonly Category[],
): Verdict {
  const value = BigInt(amount);

  /*
   * A credit on an invoice is a refund or the bill being paid, never an
   * earning — the one on the measured invoice was "Pag Fatura Boleto". The
   * server refuses it, so it belongs in the blocked set with its own reason:
   * the action is to ignore it, not to map anything.
   */
  if (side === "card" && value < 0n) {
    return { ready: false, blocker: "card-credit" };
  }
  if (!descriptor) return { ready: false, blocker: "no-descriptor" };

  /*
   * Naming another account is the declaration that this is a transfer, and a
   * transfer needs neither party nor category: it moves money between two of
   * your own accounts, so there is no counterparty and nothing to classify.
   */
  if (side === "account" && descriptor.counterAccountId) {
    return { ready: true, becomes: "transfer" };
  }

  if (!descriptor.partyId) return { ready: false, blocker: "no-party" };
  if (!descriptor.categoryId) return { ready: false, blocker: "no-category" };

  const inflow = side === "account" && value > 0n;
  const category = categories.find(
    (candidate) => candidate.id === descriptor.categoryId,
  );
  const wanted = inflow ? "REVENUE" : "EXPENSE";
  if (!category || category.kind !== wanted) {
    return { ready: false, blocker: "wrong-kind" };
  }

  return { ready: true, becomes: inflow ? "revenue" : "expense" };
}

/** One decision, and every line it covers. */
export type ReadyDecision = {
  /** Side, account and wording — stable across reloads, unique per decision. */
  id: string;
  side: Side;
  accountId: string;
  descriptorKey: string;
  becomes: Becomes;
  partyId: string | null;
  categoryId: string | null;
  counterAccountId: string | null;
  lines: Movement[];
  /** Signed minor units, summed over the lines. */
  total: string;
};

/** One reason lines are held back, with how much is behind it. */
export type BlockedReason = {
  blocker: Blocker;
  side: Side;
  lines: number;
  /** Distinct wordings, which is how many decisions would clear it. */
  descriptors: number;
  total: string;
};

export type PromotionPlan = {
  ready: ReadyDecision[];
  blocked: BlockedReason[];
  readyLines: number;
  blockedLines: number;
};

function descriptorFor(
  descriptors: readonly CatalogRecord[],
  accountId: string,
  key: string,
): CatalogRecord | undefined {
  return descriptors.find(
    (candidate) => candidate.accountId === accountId && candidate.key === key,
  );
}

/**
 * Groups the staged lines into decisions to confirm and reasons to go fix.
 *
 * Ready decisions come out ordered by how many lines each one releases, which
 * is the same ordering the review bench uses: the most leverage first, so the
 * list reads as what it is rather than as an alphabet.
 */
export function planPromotion(input: {
  card: readonly Movement[];
  account: readonly Movement[];
  cardDescriptors: readonly CatalogRecord[];
  accountDescriptors: readonly CatalogRecord[];
  categories: readonly Category[];
}): PromotionPlan {
  const decisions = new Map<string, ReadyDecision>();
  const reasons = new Map<
    string,
    BlockedReason & { keys: Set<string>; sum: bigint }
  >();
  let readyLines = 0;
  let blockedLines = 0;

  for (const side of ["card", "account"] as const) {
    const movements = side === "card" ? input.card : input.account;
    const descriptors =
      side === "card" ? input.cardDescriptors : input.accountDescriptors;

    for (const movement of movements) {
      if (movement.status !== "PENDING") continue;
      const descriptor = descriptorFor(
        descriptors,
        movement.accountId,
        movement.descriptorKey,
      );
      const verdict = verdictFor(
        side,
        movement.amount,
        descriptor,
        input.categories,
      );
      const id = `${side}:${movement.accountId}:${movement.descriptorKey}`;

      if (verdict.ready) {
        readyLines += 1;
        const existing = decisions.get(id);
        if (existing) {
          existing.lines.push(movement);
          existing.total = (
            BigInt(existing.total) + BigInt(movement.amount)
          ).toString();
          continue;
        }
        decisions.set(id, {
          id,
          side,
          accountId: movement.accountId,
          descriptorKey: movement.descriptorKey,
          becomes: verdict.becomes,
          partyId: descriptor?.partyId ?? null,
          categoryId: descriptor?.categoryId ?? null,
          counterAccountId: descriptor?.counterAccountId ?? null,
          lines: [movement],
          total: movement.amount,
        });
        continue;
      }

      blockedLines += 1;
      const reasonId = `${side}:${verdict.blocker}`;
      const reason = reasons.get(reasonId);
      if (reason) {
        reason.lines += 1;
        reason.keys.add(movement.descriptorKey);
        reason.sum += BigInt(movement.amount);
        continue;
      }
      reasons.set(reasonId, {
        blocker: verdict.blocker,
        side,
        lines: 1,
        descriptors: 1,
        total: movement.amount,
        keys: new Set([movement.descriptorKey]),
        sum: BigInt(movement.amount),
      });
    }
  }

  const ready = [...decisions.values()].sort(
    (a, b) =>
      b.lines.length - a.lines.length ||
      (absolute(b.total) > absolute(a.total) ? 1 : -1),
  );

  const blocked = [...reasons.values()]
    .map(({ keys, sum, ...reason }) => ({
      ...reason,
      descriptors: keys.size,
      total: sum.toString(),
    }))
    .sort((a, b) => b.lines - a.lines);

  return { ready, blocked, readyLines, blockedLines };
}

function absolute(amount: string): bigint {
  const value = BigInt(amount);
  return value < 0n ? -value : value;
}

/**
 * The month the promotion is filed under.
 *
 * The first day of the line's own month, in UTC. On an account line that is
 * the answer — the money moved when the statement says it did, and there is no
 * cycle to read. On a card line the server computes it from the registered
 * billing windows and ignores what is sent, so this is what the field carries
 * rather than what decides the invoice.
 */
export function referenceMonthOf(iso: string): string {
  const date = new Date(iso);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  ).toISOString();
}
