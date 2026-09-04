export type ImportedMovementKind = "DEBIT" | "CREDIT";

export type ImportedMovement = {
  id: string;
  bookId: string;
  provider: string;
  providerAccountId: string;
  externalReference: string;
  kind: ImportedMovementKind;
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
  status: "REVIEW" | "CONVERTED" | "UNCHANGED";
  createdAt?: Date;
};

export type ImportResult = {
  movement: ImportedMovement;
  unchanged: boolean;
};

export function normalizeMovement(input: {
  bookId: string;
  provider: string;
  providerAccountId: string;
  externalReference: string;
  kind: ImportedMovementKind;
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
}): ImportedMovement {
  if (!input.bookId.trim() || !input.provider.trim()) {
    throw new Error("bookId and provider are required");
  }
  if (!input.externalReference.trim()) {
    throw new Error("externalReference is required");
  }
  if (input.amountMinor <= 0n) {
    throw new Error("amountMinor must be positive");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("currency must be a three-letter uppercase code");
  }
  return {
    id: "",
    bookId: input.bookId,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    externalReference: input.externalReference,
    kind: input.kind,
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt: input.occurredAt,
    status: "REVIEW",
  };
}

export function isUnchanged(existing: ImportedMovement): boolean {
  return existing.status === "UNCHANGED";
}
