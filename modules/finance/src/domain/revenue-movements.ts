/**
 * Revenue movement evidence (ADR 19): a day's sales by payment method, as
 * the point of sale or the acquirer reports them. Each record is up to four
 * revenues, one per component, which add up to what will be received:
 * - the gross sold;
 * - minus the discount given (a negative revenue under a DEDUCTION category);
 * - plus the service fee charged (the tip);
 * - minus the acquirer's fee (negative, DEDUCTION).
 *
 * The point of sale's record carries the first three. The acquirer's carries
 * its gross, which is what the point of sale recorded as paid, so it is not
 * recognized again: only the acquirer's fee becomes a revenue.
 *
 * Nothing is inferred from a record's wording (ADR 16): each component has its
 * own descriptor, `<method>_bruto`, `_desconto`, `_taxa`, `_taxa_adquirente`,
 * and a record posts only when every component it carries has one filled.
 */
import type { MovementStatus } from "./account-movements";

export const revenueComponents = [
  "GROSS",
  "DISCOUNT",
  "FEE",
  "ACQUIRER_FEE",
] as const;
export type RevenueComponent = (typeof revenueComponents)[number];

/** The suffix of a component's descriptor key and record key, in the owner's words. */
export const COMPONENT_SUFFIX: Record<RevenueComponent, string> = {
  GROSS: "bruto",
  DISCOUNT: "desconto",
  FEE: "taxa",
  ACQUIRER_FEE: "taxa_adquirente",
};

/** The components booked under a DEDUCTION category: negative revenues. */
export const isDeductionComponent = (component: RevenueComponent): boolean =>
  component === "DISCOUNT" || component === "ACQUIRER_FEE";

/** What a parser reads from one record, in Lastro's units. */
export type RevenueObservation = {
  /** The operational day the record covers. */
  occurredOn: Date;
  /** The payment method as the point of sale prints it ("Pix", "Crédito"). */
  name: string;
  quantity: number;
  /** The products sold, before discount and fee. Minor units. */
  gross: bigint;
  /** What will be received: gross − discount + fee − acquirer fee. */
  amount: bigint;
  discount: bigint;
  /** The service fee (`acréscimo`), the tip. */
  fee: bigint;
  /** What the acquirer keeps (MDR, anticipation). */
  acquirerFee: bigint;
  /** False when the gross is what another source already recognized. */
  grossRecognized: boolean;
  currency: string;
};

export type RevenueMovementDescriptor = {
  bookId: string;
  accountId: string;
  descriptorKey: string;
  component: RevenueComponent;
  name: string;
  partyId: string | null;
  financialCategoryId: string | null;
  /** On an acquirer's fee: the deposit group its records are paid in (ADR 20). */
  settlementGroup: string | null;
  /** On an acquirer's fee: the point of sale's method its gross settles. */
  settlesMethodKey: string | null;
  /** On a point of sale's gross: the account its money is received in on the day (cash). */
  receivedAccountId: string | null;
};

/** The receipt that collected an acquirer's record (ADR 20). */
export type RevenueMovementReceipt = {
  bookId: string;
  movementId: string;
  receiptId: string;
  /** The record's own receipt, made when it posted (cash). */
  own: boolean;
};

export type RevenueMovement = {
  id: string;
  bookId: string;
  accountId: string;
  fileId: string;
  /** The sha256 of the day, the method and the total paid: the record, and its revenues' external key. */
  externalId: string;
  occurredOn: Date;
  name: string;
  /** The normalized method name the component descriptor keys start with. */
  methodKey: string;
  quantity: number;
  gross: bigint;
  discount: bigint;
  fee: bigint;
  acquirerFee: bigint;
  grossRecognized: boolean;
  amount: bigint;
  currency: string;
  status: MovementStatus;
  ignoreReason: string | null;
};

/** One revenue a record became. */
export type RevenueMovementLink = {
  bookId: string;
  movementId: string;
  component: RevenueComponent;
  /** Shared by the record's revenues: its external id. */
  externalKey: string;
  /** The sha256 of the external id, the component and the item's amount: this item. */
  statementId: string;
  /** `<group key>-<bruto|desconto|taxa|taxa_adquirente>`, also the revenue's own key. */
  revenueKey: string;
  revenueId: string;
};

/** A record adds up when its amount is gross − discount + fee − acquirer fee. */
export function addsUp(
  observation: Pick<
    RevenueObservation,
    "gross" | "amount" | "discount" | "fee" | "acquirerFee"
  >,
): boolean {
  return (
    observation.gross -
      observation.discount +
      observation.fee -
      observation.acquirerFee ===
    observation.amount
  );
}

export const componentKey = (
  base: string,
  component: RevenueComponent,
): string => `${base}_${COMPONENT_SUFFIX[component]}`;

/**
 * The components a record posts: the gross when it is recognized here, and
 * the discount, fee and acquirer fee when not zero.
 */
export function componentsOf(
  movement: Pick<
    RevenueMovement,
    "gross" | "discount" | "fee" | "acquirerFee" | "grossRecognized"
  >,
): { component: RevenueComponent; amount: bigint }[] {
  const all: { component: RevenueComponent; amount: bigint }[] = [
    {
      component: "GROSS",
      amount: movement.grossRecognized ? movement.gross : 0n,
    },
    // A discount is a negative revenue under a DEDUCTION category (ADR 6).
    { component: "DISCOUNT", amount: -movement.discount },
    { component: "FEE", amount: movement.fee },
    { component: "ACQUIRER_FEE", amount: -movement.acquirerFee },
  ];
  return all.filter((each) => each.amount !== 0n);
}
