/**
 * What a statement parser is (ADR 13): a registry entry that reads a file's
 * text and returns finance's observations for one evidence family. It decides
 * nothing: identity, provenance, staging, descriptors and posting are
 * finance's.
 */
import type {
  AccountMovementObservation,
  CardObservation,
  RevenueObservation,
} from "@lastro/finance";
import type { ImporterDefinition } from "@lastro/kernel";

export type MovementImporter = ImporterDefinition &
  (
    | Readonly<{
        /** A bank account's statement: payment and receipt movements. */
        evidence: "account-movements";
        /** Pure: the same text always gives the same observations, or throws. */
        parse(content: string): readonly AccountMovementObservation[];
      }>
    | Readonly<{
        /**
         * An acquirer's deposits into a bank account: receipt movements of
         * that account, beside its own statement's (ADR 20).
         */
        evidence: "receipt-movements";
        parse(content: string): readonly AccountMovementObservation[];
      }>
    | Readonly<{
        /** A card's invoice: purchases and their instalments. */
        evidence: "card-movements";
        parse(content: string): readonly CardObservation[];
      }>
    | Readonly<{
        /** A point of sale's day by payment method: gross, discount and fee. */
        evidence: "revenue-movements";
        parse(content: string): readonly RevenueObservation[];
      }>
  );

const EVIDENCE = new Set([
  "account-movements",
  "receipt-movements",
  "card-movements",
  "revenue-movements",
]);

/**
 * A contributed item, checked before it reaches the registry: another
 * module's manifest is data this one cannot type-check.
 */
export function asMovementImporter(item: unknown): MovementImporter {
  const candidate = item as Partial<MovementImporter> | null;
  if (
    !candidate ||
    typeof candidate.id !== "string" ||
    typeof candidate.version !== "number" ||
    typeof candidate.parse !== "function" ||
    !EVIDENCE.has(String(candidate.evidence))
  )
    throw new Error(
      `contributed statement importer ${String(candidate?.id)} needs an id, a version, a parse function and one of the evidence families ${[...EVIDENCE].join(", ")}`,
    );
  return candidate as MovementImporter;
}
