/**
 * Account movements on the wire (ADR 17), one set per side: payment
 * movements are money out of an account, receipt movements money in. Each
 * side's tools take only that side's fields. Browser-safe.
 */
import {
  Amount,
  CalendarDate,
  Currency,
  CursorPage,
  Id,
  IsoDate,
  Page,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";
import { PaymentMethod } from "./expenses";

export const MovementDirection = z.enum(["PAYMENT", "RECEIPT"]);
export const MovementStatus = z.enum(["PENDING", "POSTED", "IGNORED"]);
/** The kind of content a consumer reads, such as `account-movements`. */
export const MovementType = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,49}$/,
    "a lowercase type such as account-movements",
  );
const PositiveAmount = Amount.regex(/^0*[1-9]\d*$/, "must be positive");
const Reason = z.string().trim().min(1).max(500);
/* Query booleans are explicit text: a coerced "false" is true. */
const QueryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const MovementConsumerResource = z
  .object({
    bookId: Id,
    accountId: Id,
    movementType: MovementType,
    importerId: z.string(),
    setBy: z.string(),
    setAt: IsoDate,
  })
  .strict();

export const MovementFileResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    movementType: MovementType,
    importerId: z.string(),
    importerVersion: z.number().int(),
    importerFingerprint: z.string(),
    contentSha256: z.string(),
    sourceKey: z.string(),
    lineCount: z.number().int(),
    newCount: z.number().int(),
    importedBy: z.string(),
    importedAt: IsoDate,
  })
  .strict();

/** What one intake did; also answered, unchanged, for content taken in before. */
export const MovementIntakeResult = z
  .object({
    file: MovementFileResource,
    alreadyImported: z.boolean(),
    lines: z.number().int(),
    new: z.number().int(),
    known: z.number().int(),
    posted: z.number().int(),
    pending: z.number().int(),
  })
  .strict();

export const listMovementFiles = defineOperation({
  id: "finance.listMovementFiles",
  access: "read",
  input: CursorPage.extend({ accountId: Id.optional() }).strict(),
  output: Page(MovementFileResource),
  http: { method: "GET", path: "/movement-files" },
  mcp: {
    name: "list_movement_files",
    description:
      "List the contents taken in, newest first, optionally for one account: type, importer, content hash, source key, lines and how many were new.",
  },
});

const Classification = {
  partyId: Id.nullable(),
  financialCategoryId: Id.nullable(),
  counterAccountId: Id.nullable(),
  paymentMethod: PaymentMethod.nullable(),
};

const ClassificationInput = {
  partyId: Id.nullable().optional(),
  financialCategoryId: Id.nullable().optional(),
  counterAccountId: Id.nullable().optional(),
  paymentMethod: PaymentMethod.nullable().optional(),
};

/**
 * Money in for sales already recognized (ADR 20), on a receipt with a party
 * and no financial category: the group of the acquirer's sales it pays, as
 * their descriptors name it.
 */
const SettlementGroup = z.string().trim().min(1).max(100);

const movementFields = {
  id: Id,
  bookId: Id,
  accountId: Id,
  fileId: Id,
  externalId: z.string(),
  occurredOn: CalendarDate,
  occurredAt: IsoDate.nullable(),
  amount: Amount,
  currency: Currency,
  name: z.string(),
  descriptorKey: z.string(),
  description: z.string(),
  ...Classification,
  status: MovementStatus,
  ignoreReason: z.string().nullable(),
};

const descriptorFields = {
  bookId: Id,
  accountId: Id,
  descriptorKey: z.string(),
  name: z.string(),
  ...Classification,
};

const linkFields = {
  id: Id,
  bookId: Id,
  movementId: Id,
  externalKey: z.string(),
  statementKey: z.string(),
  amount: Amount,
  transferId: Id.nullable(),
};

export const PaymentMovementResource = z.object(movementFields).strict();
export const ReceiptMovementResource = z
  .object({
    ...movementFields,
    settlementGroup: z.string().nullable(),
    /** A promise of money in, posted as an expected receipt (ADR 20). */
    promise: z.boolean(),
  })
  .strict();

export const PaymentMovementDescriptorResource = z
  .object(descriptorFields)
  .strict();
export const ReceiptMovementDescriptorResource = z
  .object({ ...descriptorFields, settlementGroup: z.string().nullable() })
  .strict();

export const PaymentMovementLinkResource = z
  .object({
    ...linkFields,
    expenseId: Id.nullable(),
    expenseKey: z.string().nullable(),
    paymentId: Id.nullable(),
    paymentKey: z.string().nullable(),
  })
  .strict();
export const ReceiptMovementLinkResource = z
  .object({
    ...linkFields,
    revenueId: Id.nullable(),
    revenueKey: z.string().nullable(),
    receiptId: Id.nullable(),
    receiptKey: z.string().nullable(),
  })
  .strict();

const listInput = CursorPage.extend({
  accountId: Id.optional(),
  status: MovementStatus.optional(),
  descriptorKey: z.string().min(1).optional(),
}).strict();

const descriptorListInput = z
  .object({
    accountId: Id.optional(),
    classified: QueryBoolean.optional(),
  })
  .strict();

const LINK_KEYS =
  "Every link has `externalKey` (the movement's external id: the source's id, or the hash of its line; shared by all records one movement became) and `statementKey` `<from>-<METHOD>-<to>-YYYYMMDD-<amount>` (ends a<accountId> or p<partyId>, e.g. a3-PIX-a1-20260106-16500), which both statements of one transfer, or a deposit and its bank line, share.";

const AFTER_CLASSIFY =
  "Every PENDING movement of the descriptor this completes is posted at once, and later files post on their own. Answers how many were posted.";

const UNDO =
  "Its links are removed and the settlements its post made are voided; a transfer no other link names is removed. An expense or revenue the post created stays and is reused when the movement is posted again the same way.";

/* Payment movements: money out of an account. */

export const listPaymentMovements = defineOperation({
  id: "finance.listPaymentMovements",
  access: "read",
  input: listInput,
  output: Page(PaymentMovementResource),
  http: { method: "GET", path: "/payment-movements" },
  mcp: {
    name: "list_payment_movements",
    description:
      "List payment movements (lines that took money out of an account), newest first. Filter by account, status (PENDING, POSTED, IGNORED) or descriptorKey.",
  },
});

export const listPaymentMovementDescriptors = defineOperation({
  id: "finance.listPaymentMovementDescriptors",
  access: "read",
  input: descriptorListInput,
  output: z
    .object({ items: z.array(PaymentMovementDescriptorResource) })
    .strict(),
  http: { method: "GET", path: "/payment-movement-descriptors" },
  mcp: {
    name: "list_payment_movement_descriptors",
    description:
      'List the payment movement descriptors: one per account and descriptorKey (the normalized name), with the party and EXPENSE financial category, or the Book\'s other account (a transfer), and the payment method. `classified: "false"` lists the ones still to classify.',
  },
});

export const listPaymentMovementLinks = defineOperation({
  id: "finance.listPaymentMovementLinks",
  access: "read",
  input: z
    .object({
      movementId: Id.optional(),
      externalKey: z.string().min(1).optional(),
      statementKey: z.string().min(1).optional(),
      transferId: Id.optional(),
      expenseKey: z.string().min(1).optional(),
      paymentKey: z.string().min(1).optional(),
    })
    .strict()
    .refine(
      (value) => Object.values(value).some((each) => each !== undefined),
      "name movementId, externalKey, statementKey, transferId, expenseKey or paymentKey",
    ),
  output: z.object({ items: z.array(PaymentMovementLinkResource) }).strict(),
  http: { method: "GET", path: "/payment-movement-links" },
  mcp: {
    name: "list_payment_movement_links",
    description: `What posted payment movements became: a transfer, or an expense (\`expenseKey\` \`<externalKey>-<n>\`) and its payment (\`paymentKey\` \`<externalKey>-payment\`). ${LINK_KEYS}`,
  },
});

export const classifyPaymentMovementDescriptor = defineOperation({
  id: "finance.classifyPaymentMovementDescriptor",
  access: "write",
  input: z
    .object({
      accountId: Id,
      descriptorKey: z.string().min(1),
      ...ClassificationInput,
    })
    .strict(),
  output: z
    .object({
      descriptor: PaymentMovementDescriptorResource,
      posted: z.number().int(),
    })
    .strict(),
  http: { method: "PATCH", path: "/payment-movement-descriptors" },
  mcp: {
    name: "classify_payment_movement_descriptor",
    description: `Say what a name always is when money leaves an account: a party and an EXPENSE financial category (an expense paid), or another account of the Book (\`counterAccountId\`: a transfer). And the payment method, which only the descriptor gives. ${AFTER_CLASSIFY}`,
  },
});

export const postPaymentMovement = defineOperation({
  id: "finance.postPaymentMovement",
  access: "write",
  input: z
    .object({
      id: Id,
      ...ClassificationInput,
      /** Pay these open expenses; the shares add up to the movement. */
      expenses: z
        .array(z.object({ expenseId: Id, amount: PositiveAmount }).strict())
        .min(1)
        .optional(),
      /** Also classify the movement's descriptor, if it is not yet. Default true. */
      remember: z.boolean().optional(),
    })
    .strict(),
  output: z
    .object({
      movement: PaymentMovementResource,
      links: z.array(PaymentMovementLinkResource),
    })
    .strict(),
  http: { method: "POST", path: "/payment-movements/:id/post" },
  mcp: {
    name: "post_payment_movement",
    description:
      "Post one PENDING payment movement and answer its links. With counterAccountId: a transfer to that account of the Book, joining one with the same statementKey. With expenses: one payment on the movement's date settling those open expenses, shares adding up to the amount (list_open_expenses finds them). Otherwise with partyId and financialCategoryId: a new expense, paid. Fields left out come from the descriptor; `remember` (default true) classifies an unclassified descriptor the same way.",
  },
});

export const ignorePaymentMovement = defineOperation({
  id: "finance.ignorePaymentMovement",
  access: "write",
  input: z.object({ id: Id, reason: Reason }).strict(),
  output: PaymentMovementResource,
  http: { method: "POST", path: "/payment-movements/:id/ignore" },
  mcp: {
    name: "ignore_payment_movement",
    description:
      "Mark a PENDING payment movement as deliberately not a financial record, with the reason.",
  },
});

export const undoPaymentMovement = defineOperation({
  id: "finance.undoPaymentMovement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, reason: Reason.optional() }).strict(),
  output: PaymentMovementResource,
  http: { method: "POST", path: "/payment-movements/:id/undo" },
  mcp: {
    name: "undo_payment_movement",
    description: `Return a POSTED or IGNORED payment movement to PENDING. ${UNDO}`,
  },
});

/* Receipt movements: money into an account, and promises of it. */

export const listReceiptMovements = defineOperation({
  id: "finance.listReceiptMovements",
  access: "read",
  input: listInput,
  output: Page(ReceiptMovementResource),
  http: { method: "GET", path: "/receipt-movements" },
  mcp: {
    name: "list_receipt_movements",
    description:
      "List receipt movements (lines that brought money into an account, and an acquirer's promised deposits, `promise: true`), newest first. Filter by account, status (PENDING, POSTED, IGNORED) or descriptorKey.",
  },
});

export const listReceiptMovementDescriptors = defineOperation({
  id: "finance.listReceiptMovementDescriptors",
  access: "read",
  input: descriptorListInput,
  output: z
    .object({ items: z.array(ReceiptMovementDescriptorResource) })
    .strict(),
  http: { method: "GET", path: "/receipt-movement-descriptors" },
  mcp: {
    name: "list_receipt_movement_descriptors",
    description:
      'List the receipt movement descriptors: one per account and descriptorKey (the normalized name), with the party and REVENUE financial category, the Book\'s other account (a transfer), or the party and settlement group of the sales it settles, and the payment method. `classified: "false"` lists the ones still to classify.',
  },
});

export const listReceiptMovementLinks = defineOperation({
  id: "finance.listReceiptMovementLinks",
  access: "read",
  input: z
    .object({
      movementId: Id.optional(),
      externalKey: z.string().min(1).optional(),
      statementKey: z.string().min(1).optional(),
      transferId: Id.optional(),
      revenueKey: z.string().min(1).optional(),
      receiptKey: z.string().min(1).optional(),
    })
    .strict()
    .refine(
      (value) => Object.values(value).some((each) => each !== undefined),
      "name movementId, externalKey, statementKey, transferId, revenueKey or receiptKey",
    ),
  output: z.object({ items: z.array(ReceiptMovementLinkResource) }).strict(),
  http: { method: "GET", path: "/receipt-movement-links" },
  mcp: {
    name: "list_receipt_movement_links",
    description: `What posted receipt movements became: a transfer, or a revenue (\`revenueKey\` \`<externalKey>-<n>\`, null when the receipt settles sales) and its receipt (\`receiptKey\` \`<externalKey>-receipt\`). ${LINK_KEYS}`,
  },
});

export const classifyReceiptMovementDescriptor = defineOperation({
  id: "finance.classifyReceiptMovementDescriptor",
  access: "write",
  input: z
    .object({
      accountId: Id,
      descriptorKey: z.string().min(1),
      ...ClassificationInput,
      settlementGroup: SettlementGroup.nullable().optional(),
    })
    .strict(),
  output: z
    .object({
      descriptor: ReceiptMovementDescriptorResource,
      posted: z.number().int(),
    })
    .strict(),
  http: { method: "PATCH", path: "/receipt-movement-descriptors" },
  mcp: {
    name: "classify_receipt_movement_descriptor",
    description: `Say what a name always is when money enters an account: a party and a REVENUE financial category (a revenue received); another account of the Book (\`counterAccountId\`: a transfer); or a party with a \`settlementGroup\` and no category (money for sales already recognized: one receipt that settles the open sales of that group, oldest first, whose nets add up to it, and no revenue). And the payment method, which only the descriptor gives. ${AFTER_CLASSIFY}`,
  },
});

export const postReceiptMovement = defineOperation({
  id: "finance.postReceiptMovement",
  access: "write",
  input: z
    .object({
      id: Id,
      ...ClassificationInput,
      settlementGroup: SettlementGroup.nullable().optional(),
      /** Receive these revenues; the shares add up to the movement. */
      revenues: z
        .array(z.object({ revenueId: Id, amount: PositiveAmount }).strict())
        .min(1)
        .optional(),
      /** Also classify the movement's descriptor, if it is not yet. Default true. */
      remember: z.boolean().optional(),
    })
    .strict(),
  output: z
    .object({
      movement: ReceiptMovementResource,
      links: z.array(ReceiptMovementLinkResource),
    })
    .strict(),
  http: { method: "POST", path: "/receipt-movements/:id/post" },
  mcp: {
    name: "post_receipt_movement",
    description:
      "Post one PENDING receipt movement and answer its links. With counterAccountId: a transfer from that account of the Book, joining one with the same statementKey. With revenues: one receipt on the movement's date settling those revenues, shares adding up to the amount. With partyId and settlementGroup: a receipt settling that group's open sales. Otherwise with partyId and financialCategoryId: a new revenue, received. A promise posts its receipt expected, with no paid date. Fields left out come from the descriptor; `remember` (default true) classifies an unclassified descriptor the same way.",
  },
});

export const ignoreReceiptMovement = defineOperation({
  id: "finance.ignoreReceiptMovement",
  access: "write",
  input: z.object({ id: Id, reason: Reason }).strict(),
  output: ReceiptMovementResource,
  http: { method: "POST", path: "/receipt-movements/:id/ignore" },
  mcp: {
    name: "ignore_receipt_movement",
    description:
      "Mark a PENDING receipt movement as deliberately not a financial record, with the reason.",
  },
});

export const undoReceiptMovement = defineOperation({
  id: "finance.undoReceiptMovement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, reason: Reason.optional() }).strict(),
  output: ReceiptMovementResource,
  http: { method: "POST", path: "/receipt-movements/:id/undo" },
  mcp: {
    name: "undo_receipt_movement",
    description: `Return a POSTED or IGNORED receipt movement to PENDING. ${UNDO}`,
  },
});

export const accountMovementOperations = [
  listMovementFiles,
  listPaymentMovements,
  listPaymentMovementDescriptors,
  listPaymentMovementLinks,
  classifyPaymentMovementDescriptor,
  postPaymentMovement,
  ignorePaymentMovement,
  undoPaymentMovement,
  listReceiptMovements,
  listReceiptMovementDescriptors,
  listReceiptMovementLinks,
  classifyReceiptMovementDescriptor,
  postReceiptMovement,
  ignoreReceiptMovement,
  undoReceiptMovement,
] as const;
