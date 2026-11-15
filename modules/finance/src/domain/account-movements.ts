/**
 * Account movement evidence (ADRs 14 and 17): the consumer that reads an
 * account's content, the files finance took in, the movements they showed,
 * the descriptors that remember how a name is posted, and the links from a
 * movement to the records it became.
 *
 * A movement is evidence, not a financial record (ADRs 2 and 13). It becomes one by
 * posting: a payment movement pays expenses through a payment or is the
 * source side of a transfer; a receipt movement receives revenues through a
 * receipt or is the destination side. Each link carries a statement key, so
 * the other side of a transfer, from another account's statement, finds the
 * transfer this side already created (ADR 17).
 */
import { LastroError } from "@lastro/kernel";
import type { PaymentMethod } from "./records";

/** Money out of the account is a payment movement; money in, a receipt movement. */
export const movementDirections = ["PAYMENT", "RECEIPT"] as const;
export type MovementDirection = (typeof movementDirections)[number];

export const movementStatuses = ["PENDING", "POSTED", "IGNORED"] as const;
export type MovementStatus = (typeof movementStatuses)[number];

/** The kind of content a consumer reads, such as `account-movements`. */
export const MOVEMENT_TYPE = /^[a-z][a-z0-9-]{0,49}$/;

/** What a parser reads from one line, already in Lastro's units. */
export type AccountMovementObservation = {
  /**
   * The provider's id for the line, unique per account; null when the file
   * has none, and then the line is identified by the sha256 of its text.
   */
  externalId: string | null;
  /** The line's text. */
  line: string;
  occurredOn: Date;
  occurredAt: Date | null;
  /** Signed minor units: positive in, negative out, never zero. */
  amount: bigint;
  currency: string;
  /** Who is on the other side, as the line names them; the descriptor key comes from it. */
  name: string;
  /** The line's full text. */
  description: string;
  /**
   * A promise of money in, not the money (ADR 20): an acquirer's report of a
   * deposit due on `occurredOn`. It posts an expected receipt, which the bank
   * line pays.
   */
  promise?: boolean;
};

/** The importer that read a file, as the registry identifies it. */
export type ImporterIdentity = {
  id: string;
  version: number;
  fingerprint: string;
};

/** Which importer reads one account's content of one type (ADR 17). */
export type MovementConsumer = {
  bookId: string;
  accountId: string;
  movementType: string;
  importerId: string;
  setBy: string;
  setAt: Date;
};

export type MovementFile = {
  id: string;
  bookId: string;
  accountId: string;
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

/** What a movement is, or would be, posted as. Set by a descriptor, a match or a person. */
export type AccountMovementMapping = {
  partyId: string | null;
  financialCategoryId: string | null;
  /** Another account of the Book: the movement is one side of a transfer. */
  counterAccountId: string | null;
  /**
   * The method the payment, receipt or statement key records. It comes from
   * the descriptor only, never from the wording; a movement needs it to post.
   */
  paymentMethod: PaymentMethod | null;
  /**
   * Money in for sales already recognized (ADR 20): with a party and the
   * payment method and no financial category, a receipt movement posts a
   * receipt that settles the open sales of this group, and no revenue.
   */
  settlementGroup: string | null;
};

/** A descriptor is addressed by its account, direction and key. */
export type DescriptorRef = {
  accountId: string;
  direction: MovementDirection;
  descriptorKey: string;
};

export type AccountMovementDescriptor = AccountMovementMapping &
  DescriptorRef & {
    bookId: string;
    /** The name as first seen. */
    name: string;
  };

export type AccountMovement = AccountMovementMapping & {
  id: string;
  bookId: string;
  direction: MovementDirection;
  accountId: string;
  fileId: string;
  externalId: string;
  occurredOn: Date;
  occurredAt: Date | null;
  /** Positive minor units; the direction gives the sign. */
  amount: bigint;
  currency: string;
  name: string;
  descriptorKey: string;
  description: string;
  /** A promise of money in (ADR 20); always false for a payment movement. */
  promise: boolean;
  status: MovementStatus;
  ignoreReason: string | null;
};

/**
 * One record a posted movement became. A transfer link names the transfer;
 * any other names the expense and payment (PAYMENT) or the revenue and
 * receipt (RECEIPT). A posted movement's links add up to its amount.
 */
export type AccountMovementLink = {
  id: string;
  bookId: string;
  direction: MovementDirection;
  movementId: string;
  /** Shared by every record one movement became: its external id. */
  externalKey: string;
  statementKey: string;
  amount: bigint;
  transferId: string | null;
  expenseId: string | null;
  /** `<external key>-<n>`: this expense share. */
  expenseKey: string | null;
  paymentId: string | null;
  /** `<external key>-payment`: the movement's one payment. */
  paymentKey: string | null;
  revenueId: string | null;
  /** `<external key>-<n>`: this revenue share; null on a receipt of sales (ADR 20). */
  revenueKey: string | null;
  receiptId: string | null;
  /** `<external key>-receipt`: the movement's one receipt. */
  receiptKey: string | null;
};

export class MovementConflictError extends LastroError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("MOVEMENT_CONFLICT", message, 409, details);
    this.name = "MovementConflictError";
  }
}

/**
 * A deposit of a settlement group whose open sales do not add up to it
 * (ADR 20). Posting at intake or by classification leaves it PENDING.
 */
export class SalesNotMatchedError extends LastroError {
  constructor(movement: { id: string; amount: bigint }, group: string) {
    super(
      "SALES_NOT_MATCHED",
      `movement ${movement.id}: no open sales of group ${group} add up to its ${movement.amount}; settle it with revenues`,
      422,
      { movementId: movement.id, settlementGroup: group },
    );
    this.name = "SalesNotMatchedError";
  }
}

export class MovementStateError extends LastroError {
  constructor(message: string) {
    super("MOVEMENT_STATE", message, 422);
    this.name = "MovementStateError";
  }
}

/**
 * The descriptor key of a name: accents, case and punctuation dropped, so
 * "Fornecedor Exemplo" and "FORNECEDOR EXEMPLO" are one counterparty.
 */
export function descriptorKey(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "blank"
  );
}

/**
 * The mapping a movement takes from its descriptor: party and financial
 * category, or counter account, and payment method, as recorded. Nothing is
 * inferred from the line's wording; a new descriptor maps nothing, and its
 * lines wait until someone fills it (ADR 17).
 */
export function initialMapping(
  descriptor: AccountMovementMapping,
): AccountMovementMapping {
  return {
    partyId: descriptor.partyId,
    financialCategoryId: descriptor.financialCategoryId,
    counterAccountId: descriptor.counterAccountId,
    paymentMethod: descriptor.paymentMethod,
    settlementGroup: descriptor.settlementGroup,
  };
}

/**
 * Eligible to post with no one deciding anything more: the other end (an own
 * account, or a party with a financial category) and the payment method are
 * all known, so every part of the statement key is (ADR 17).
 */
export function isComplete(mapping: AccountMovementMapping): boolean {
  if (mapping.settlementGroup)
    return (
      mapping.paymentMethod !== null &&
      mapping.partyId !== null &&
      mapping.financialCategoryId === null &&
      mapping.counterAccountId === null
    );
  return (
    mapping.paymentMethod !== null &&
    (mapping.counterAccountId !== null ||
      (mapping.partyId !== null && mapping.financialCategoryId !== null))
  );
}

export function isClassified(mapping: AccountMovementMapping): boolean {
  return Boolean(
    mapping.partyId || mapping.financialCategoryId || mapping.counterAccountId,
  );
}

/**
 * The statement key of one link: where the money left, how, where it went,
 * the day and the amount, as
 * `<from>-<METHOD>-<to>-YYYYMMDD-<minor>`, each end `a<account>` or
 * `p<party>`, e.g. `a3-PIX-a1-20260106-16500`. Every part is known: only a
 * movement whose mapping is complete is posted. Both statements of a transfer between
 * two accounts of the Book compute the same key, which is how the second side
 * finds the transfer (ADR 17).
 */
export function statementKeyOf(
  movement: Pick<AccountMovement, "direction" | "accountId" | "occurredOn">,
  other: { accountId: string } | { partyId: string },
  amount: bigint,
  method: PaymentMethod,
): string {
  const own = `a${movement.accountId}`;
  const end =
    "accountId" in other ? `a${other.accountId}` : `p${other.partyId}`;
  const [from, to] = movement.direction === "PAYMENT" ? [own, end] : [end, own];
  const day = movement.occurredOn.toISOString().slice(0, 10).replace(/-/g, "");
  return `${from}-${method}-${to}-${day}-${amount}`;
}

/**
 * The key every link of one movement shares: its external id, the id the
 * source gave, or the hash of the line when it gave none (ADR 15).
 */
export function linkExternalKey(
  movement: Pick<AccountMovement, "externalId">,
): string {
  return movement.externalId;
}

/** The first day of the movement's month: the competence of what it creates. */
export function referenceMonthOf(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

/** A line already staged must say the same thing, or a person decides. */
export function sameMovement(
  staged: Pick<AccountMovement, "occurredOn" | "amount">,
  seen: { occurredOn: Date; amount: bigint },
): boolean {
  return (
    staged.occurredOn.getTime() === seen.occurredOn.getTime() &&
    staged.amount === seen.amount
  );
}
