/** Revenue movement evidence on the wire (ADR 19). Browser-safe. */
import {
  Amount,
  CalendarDate,
  Currency,
  CursorPage,
  Id,
  Page,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";
import { MovementStatus } from "./account-movements";

export const RevenueComponent = z.enum([
  "GROSS",
  "DISCOUNT",
  "FEE",
  "ACQUIRER_FEE",
]);
const Reason = z.string().trim().min(1).max(500);
/* Query booleans are explicit text: a coerced "false" is true. */
const QueryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const RevenueMovementDescriptorResource = z
  .object({
    bookId: Id,
    accountId: Id,
    descriptorKey: z.string(),
    component: RevenueComponent,
    name: z.string(),
    partyId: Id.nullable(),
    financialCategoryId: Id.nullable(),
    settlementGroup: z.string().nullable(),
    settlesMethodKey: z.string().nullable(),
    receivedAccountId: Id.nullable(),
  })
  .strict();

export const RevenueMovementResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    fileId: Id,
    externalId: z.string(),
    occurredOn: CalendarDate,
    name: z.string(),
    methodKey: z.string(),
    quantity: z.number().int(),
    gross: Amount,
    discount: Amount,
    fee: Amount,
    acquirerFee: Amount,
    grossRecognized: z.boolean(),
    amount: Amount,
    currency: Currency,
    status: MovementStatus,
    ignoreReason: z.string().nullable(),
  })
  .strict();

export const RevenueMovementLinkResource = z
  .object({
    bookId: Id,
    movementId: Id,
    component: RevenueComponent,
    externalKey: z.string(),
    statementId: z.string(),
    revenueKey: z.string(),
    revenueId: Id,
  })
  .strict();

export const listRevenueMovements = defineOperation({
  id: "finance.listRevenueMovements",
  access: "read",
  input: CursorPage.extend({
    accountId: Id.optional(),
    status: MovementStatus.optional(),
    methodKey: z.string().min(1).optional(),
  }).strict(),
  output: Page(RevenueMovementResource),
  http: { method: "GET", path: "/revenue-movements" },
  mcp: {
    name: "list_revenue_movements",
    description:
      "List revenue movements (a day's sales by payment method, from the point of sale or the acquirer), newest first: day, method, quantity, gross, discount, fee (the tip), acquirer fee, whether the gross is recognized here, and the amount to be received (gross − discount + fee − acquirer fee). Each record is up to four revenues. Filter by account, status or methodKey.",
  },
});

export const listRevenueMovementDescriptors = defineOperation({
  id: "finance.listRevenueMovementDescriptors",
  access: "read",
  input: z
    .object({ accountId: Id.optional(), classified: QueryBoolean.optional() })
    .strict(),
  output: z
    .object({ items: z.array(RevenueMovementDescriptorResource) })
    .strict(),
  http: { method: "GET", path: "/revenue-movement-descriptors" },
  mcp: {
    name: "list_revenue_movement_descriptors",
    description:
      'List revenue movement descriptors: one per method and component, `<method>_bruto`, `_desconto`, `_taxa`, `_taxa_adquirente`, with the party and financial category its revenue posts with. `classified: "false"` lists the ones still to fill.',
  },
});

export const listRevenueMovementLinks = defineOperation({
  id: "finance.listRevenueMovementLinks",
  access: "read",
  input: z
    .object({
      movementId: Id.optional(),
      externalKey: z.string().min(1).optional(),
      statementId: z.string().min(1).optional(),
      revenueKey: z.string().min(1).optional(),
    })
    .strict(),
  output: z.object({ items: z.array(RevenueMovementLinkResource) }).strict(),
  http: { method: "GET", path: "/revenue-movement-links" },
  mcp: {
    name: "list_revenue_movement_links",
    description:
      "The revenues posted records became, one per component. `externalKey` is the record's external id (the hash of its day, method and total paid), shared by its revenues; `statementId` is each item (the hash of the external id, the component and its amount); `revenueKey` (`<externalKey>-<bruto|desconto|taxa|taxa_adquirente>`) is the revenue's key. Search by any of them.",
  },
});

export const classifyRevenueMovementDescriptor = defineOperation({
  id: "finance.classifyRevenueMovementDescriptor",
  access: "write",
  input: z
    .object({
      accountId: Id,
      descriptorKey: z.string().min(1),
      partyId: Id,
      financialCategoryId: Id,
      /**
       * Who pays the records (ADR 20), the group a receipt descriptor names.
       * On an acquirer's fee (`_taxa_adquirente`), with `settlesMethodKey`;
       * on a point of sale's gross (`_bruto`) paid by an operator without a
       * report of its own (vouchers).
       */
      settlementGroup: z.string().trim().min(1).max(100).optional(),
      /** On an acquirer's fee: the point of sale's method (`methodKey`) its gross settles. */
      settlesMethodKey: z.string().trim().min(1).max(100).optional(),
      /** On a point of sale's gross: the account its money is in on the day (cash, the till). */
      receivedAccountId: Id.optional(),
    })
    .strict(),
  output: z
    .object({
      descriptor: RevenueMovementDescriptorResource,
      posted: z.number().int(),
    })
    .strict(),
  http: { method: "PATCH", path: "/revenue-movement-descriptors" },
  mcp: {
    name: "classify_revenue_movement_descriptor",
    description:
      "Say what one component of a payment method always is: a party and a REVENUE financial category (a DEDUCTION one for `_desconto` and `_taxa_adquirente`, a plain one for `_bruto` and `_taxa`). And who pays the records (ADR 20): on an acquirer's fee, the `settlementGroup` of the deposits that pay it and the point of sale's method its gross settles (`settlesMethodKey`); on a point of sale's gross, the `receivedAccountId` its money is in on the day (cash, the till), or the `settlementGroup` of an operator's deposits (vouchers). Every PENDING record whose components are now all filled posts at once, and later reports post on their own. Answers how many posted.",
  },
});

export const postRevenueMovement = defineOperation({
  id: "finance.postRevenueMovement",
  access: "write",
  input: z.object({ id: Id }).strict(),
  output: z
    .object({
      movement: RevenueMovementResource,
      revenues: z.array(RevenueMovementLinkResource),
    })
    .strict(),
  http: { method: "POST", path: "/revenue-movements/:id/post" },
  mcp: {
    name: "post_revenue_movement",
    description:
      "Post one PENDING record from its component descriptors: one revenue per component it carries (the gross when recognized here; the discount and the acquirer fee as negative revenues; the fee), each keyed `<record key>-<component>`. There is no choosing another record: the descriptors decide.",
  },
});

export const ignoreRevenueMovement = defineOperation({
  id: "finance.ignoreRevenueMovement",
  access: "write",
  input: z.object({ id: Id, reason: Reason }).strict(),
  output: RevenueMovementResource,
  http: { method: "POST", path: "/revenue-movements/:id/ignore" },
  mcp: {
    name: "ignore_revenue_movement",
    description:
      "Mark a PENDING revenue movement as not revenue, with the reason.",
  },
});

export const undoRevenueMovement = defineOperation({
  id: "finance.undoRevenueMovement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, reason: Reason.optional() }).strict(),
  output: RevenueMovementResource,
  http: { method: "POST", path: "/revenue-movements/:id/undo" },
  mcp: {
    name: "undo_revenue_movement",
    description:
      "Return a POSTED or IGNORED record to PENDING. Its revenue links are removed; a revenue the post created stays and is reused by the next post of the record.",
  },
});

export const revenueMovementOperations = [
  listRevenueMovements,
  listRevenueMovementDescriptors,
  listRevenueMovementLinks,
  classifyRevenueMovementDescriptor,
  postRevenueMovement,
  ignoreRevenueMovement,
  undoRevenueMovement,
] as const;
