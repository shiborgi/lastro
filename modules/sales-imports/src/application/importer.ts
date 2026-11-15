/**
 * What a sales-imports parser is (ADRs 13 and 21): a registry entry that reads a
 * file's text and returns sales' observations. It decides nothing: identity,
 * provenance, staging, descriptors and posting are sales'.
 */
import type { ImporterDefinition } from "@lastro/kernel";
import type { SaleObservation } from "@lastro/sales";

export type SaleImporter = ImporterDefinition &
  Readonly<{
    /** A point of sale's products sold on a day. */
    evidence: "sale-movements";
    /** Pure: the same text always gives the same observations, or throws. */
    parse(content: string): readonly SaleObservation[];
  }>;

/**
 * A contributed item, checked before it reaches the registry: another
 * module's manifest is data this one cannot type-check.
 */
export function asSaleImporter(item: unknown): SaleImporter {
  const candidate = item as Partial<SaleImporter> | null;
  if (
    !candidate ||
    typeof candidate.id !== "string" ||
    typeof candidate.version !== "number" ||
    typeof candidate.parse !== "function" ||
    candidate.evidence !== "sale-movements"
  )
    throw new Error(
      `contributed sales importer ${String(candidate?.id)} needs an id, a version, a parse function and the evidence family sale-movements`,
    );
  return candidate as SaleImporter;
}
