/**
 * What the staged rows say about a descriptor, gathered so the queue can be
 * ordered by how much each decision resolves.
 *
 * The institution's own category travels with the evidence and is never
 * applied: a real invoice files "BRASTEMP BY CULLIGAN" under *Aluguel*, and
 * adopting that would put a wrong fact on the books.
 */

import type { CatalogRecord, Movement } from "@/lib/api";
import type { Pending } from "./shared";

/**
 * Evidence for a descriptor that is already mapped, built here rather than
 * served: once a descriptor has everything the pending queue asks for, the
 * server drops it from that query — that is the whole point of the query —
 * so there is no endpoint that hands back a mapped descriptor bundled with
 * its movement count. The catalog list and the movement list both already
 * exist; this joins them the same way the server's own pending query does.
 *
 * Keyed by account *and* key, where the server's pending-side evidence is
 * keyed by key alone. That is safe there only because no two accounts happen
 * to share a wording among descriptors still missing something — and this
 * bench is where a wording that *does* recur across accounts would be found
 * and fixed, so the stricter key is deliberate: see the Gelagoela pair a few
 * lines below, which is exactly that shape.
 */
export type Evidence = {
  movements: number;
  total: bigint;
  dates: Date[];
  hints: Map<string, number>;
};

export function evidenceKey(accountId: string, key: string): string {
  return `${accountId}\u0000${key}`;
}

export function gatherEvidence(
  movements: readonly Pick<
    Movement,
    | "accountId"
    | "descriptorKey"
    | "amount"
    | "purchaseDate"
    | "category"
    | "title"
  >[],
): Map<string, Evidence> {
  const evidence = new Map<string, Evidence>();
  for (const row of movements) {
    const id = evidenceKey(row.accountId, row.descriptorKey);
    const entry = evidence.get(id) ?? {
      movements: 0,
      total: 0n,
      dates: [],
      hints: new Map<string, number>(),
    };
    entry.movements += 1;
    entry.total += BigInt(row.amount);
    entry.dates.push(new Date(row.purchaseDate));
    const hint = row.category ?? row.title;
    if (hint?.trim()) entry.hints.set(hint, (entry.hints.get(hint) ?? 0) + 1);
    evidence.set(id, entry);
  }
  return evidence;
}

export function summarise(seen: Evidence | undefined) {
  const dates = (seen?.dates ?? [])
    .map((date) => date.getTime())
    .sort((left, right) => left - right);
  const first = dates[0];
  const last = dates.at(-1);
  return {
    movements: seen?.movements ?? 0,
    total: (seen?.total ?? 0n).toString(),
    firstSeen: first === undefined ? null : new Date(first).toISOString(),
    lastSeen: last === undefined ? null : new Date(last).toISOString(),
    sourceCategories: [...(seen?.hints ?? new Map<string, number>())]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count),
  };
}

/**
 * The descriptors already decided, in the same shape the pending queue
 * returns — so one row component and one edit form serve both benches.
 *
 * "Decided" mirrors the server's own pending filter, inverted: a transfer (a
 * counter account named) needs only a method; anything else needs a party, a
 * category and a method. If that rule ever changes on the server, this one
 * has to change with it, or a descriptor could sit in neither list, or both.
 */
export function mappedDescriptors(
  side: "card" | "account",
  catalog: readonly CatalogRecord[],
  movements: readonly Movement[],
): Pending[] {
  const evidence = gatherEvidence(movements);
  return catalog
    .filter((row) =>
      side === "card"
        ? row.partyId != null && row.categoryId != null
        : row.counterAccountId != null
          ? row.method != null
          : row.partyId != null && row.categoryId != null && row.method != null,
    )
    .map((row) => ({
      id: row.id,
      bookId: row.bookId,
      accountId: row.accountId ?? "",
      key: row.key ?? "",
      partyId: row.partyId ?? null,
      categoryId: row.categoryId ?? null,
      method: row.method ?? null,
      counterAccountId: row.counterAccountId ?? null,
      name: row.name ?? null,
      ...summarise(
        evidence.get(evidenceKey(row.accountId ?? "", row.key ?? "")),
      ),
    }))
    .sort((left, right) => right.movements - left.movements);
}
