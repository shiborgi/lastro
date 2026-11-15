/**
 * Sales evidence (ADR 21): what a point of sale says it sold on an operational
 * day, one movement per product as it prints it. A movement becomes a sale
 * line by posting; its descriptor, keyed by the point of sale's product code,
 * names the Book's product. Nothing is inferred from the wording (ADR 16).
 */
import { LastroError } from "@lastro/kernel";

export const saleMovementStatuses = ["PENDING", "POSTED", "IGNORED"] as const;
export type SaleMovementStatus = (typeof saleMovementStatuses)[number];

/** The kind of content a consumer reads, such as `sale-movements`. */
export const SALE_TYPE = /^[a-z][a-z0-9-]{0,49}$/;

/** What a parser reads from one line, already in Lastro's units. */
export type SaleObservation = {
  /** The line's text; its sha256 is the movement's external id. */
  line: string;
  /** The operational day the line covers. */
  occurredOn: Date;
  /** The point of sale's product code, when it prints one. */
  code: string | null;
  /** The product as printed. */
  name: string;
  /** The point of sale's own grouping, as printed. Provenance only. */
  providerCategory: string | null;
  /** Exact decimal text, positive. */
  quantity: string;
  /** What the product sold for, minor units. */
  revenue: bigint;
  /** The line's total cost as the point of sale reported it, when it did. */
  cost: bigint | null;
  currency: string;
};

export type ImporterIdentity = {
  id: string;
  version: number;
  fingerprint: string;
};

/** Which importer reads the Book's sales content of one type. */
export type SaleConsumer = {
  bookId: string;
  movementType: string;
  importerId: string;
  setBy: string;
  setAt: Date;
};

export type SaleFile = {
  id: string;
  bookId: string;
  movementType: string;
  importerId: string;
  importerVersion: number;
  importerFingerprint: string;
  contentSha256: string;
  /** The caller's key for the content, such as its Drive path. Provenance only. */
  sourceKey: string;
  lineCount: number;
  newCount: number;
  importedBy: string;
  importedAt: Date;
};

/** A product code (or name, when there is none) and the product it always is. */
export type SaleMovementDescriptor = {
  bookId: string;
  descriptorKey: string;
  /** The product as first printed. */
  name: string;
  productId: string | null;
};

export type SaleMovement = {
  id: string;
  bookId: string;
  fileId: string;
  /** The sha256 of the line. */
  externalId: string;
  businessDate: Date;
  code: string | null;
  name: string;
  providerCategory: string | null;
  descriptorKey: string;
  quantity: string;
  revenue: bigint;
  cost: bigint | null;
  currency: string;
  status: SaleMovementStatus;
  ignoreReason: string | null;
};

/** What a posted sale movement became: its one sale line (ADRs 19 and 21). */
export type SaleMovementLink = {
  bookId: string;
  movementId: string;
  /** The movement's external id. */
  externalKey: string;
  /** `<external key>-sale`. */
  saleKey: string;
  saleId: string;
};

export const saleKeyOf = (externalKey: string): string => `${externalKey}-sale`;

export class SaleMovementStateError extends LastroError {
  constructor(message: string) {
    super("MOVEMENT_STATE", message, 422);
    this.name = "SaleMovementStateError";
  }
}

export class SaleConflictError extends LastroError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("SALE_CONFLICT", message, 409, details);
    this.name = "SaleConflictError";
  }
}

/** Accents, case and punctuation dropped, as for statement descriptors. */
export function normalizeKey(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "blank"
  );
}

/**
 * A line's descriptor key: the point of sale's product code, the source's own
 * id for the product, or its printed name when it has none.
 */
export const saleMovementDescriptorKey = (
  observation: Pick<SaleObservation, "code" | "name">,
): string => normalizeKey(observation.code ?? observation.name);
