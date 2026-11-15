/** Card movements on the wire (ADR 18). Browser-safe. */
import {
  CalendarDate,
  Currency,
  CursorPage,
  Id,
  Page,
  SignedAmount,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";
import { MovementStatus } from "./account-movements";
import { PaymentMethod } from "./expenses";

const Reason = z.string().trim().min(1).max(500);
/* Query booleans are explicit text: a coerced "false" is true. */
const QueryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const CardDescriptorResource = z
  .object({
    bookId: Id,
    accountId: Id,
    descriptorKey: z.string(),
    name: z.string(),
    partyId: Id.nullable(),
    financialCategoryId: Id.nullable(),
    counterAccountId: Id.nullable(),
    paymentMethod: PaymentMethod.nullable(),
  })
  .strict();

export const CardMovementResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    fileId: Id,
    statementId: z.string(),
    externalId: z.string(),
    paymentKey: z.string(),
    expenseKey: z.string(),
    occurredOn: CalendarDate,
    amount: SignedAmount,
    currency: Currency,
    name: z.string(),
    descriptorKey: z.string(),
    description: z.string(),
    cardholder: z.string().nullable(),
    cardLast4: z.string().nullable(),
    providerCategory: z.string().nullable(),
    installmentNumber: z.number().int(),
    installmentCount: z.number().int(),
    partyId: Id.nullable(),
    financialCategoryId: Id.nullable(),
    counterAccountId: Id.nullable(),
    paymentMethod: PaymentMethod.nullable(),
    status: MovementStatus,
    ignoreReason: z.string().nullable(),
  })
  .strict();

export const CardExpenseLinkResource = z
  .object({
    bookId: Id,
    accountId: Id,
    expenseKey: z.string(),
    expenseId: Id,
  })
  .strict();

export const CardPaymentLinkResource = z
  .object({
    bookId: Id,
    accountId: Id,
    paymentKey: z.string(),
    expenseKey: z.string(),
    installmentNumber: z.number().int(),
    installmentCount: z.number().int(),
    paymentId: Id,
    settlementId: Id,
    movementId: Id.nullable(),
  })
  .strict();

export const CardTransferLinkResource = z
  .object({
    bookId: Id,
    accountId: Id,
    movementId: Id,
    externalKey: z.string(),
    statementKey: z.string(),
    transferId: Id,
  })
  .strict();

const Links = z
  .object({
    expenses: z.array(CardExpenseLinkResource),
    payments: z.array(CardPaymentLinkResource),
    transfers: z.array(CardTransferLinkResource),
  })
  .strict();

export const listCardMovements = defineOperation({
  id: "finance.listCardMovements",
  access: "read",
  input: CursorPage.extend({
    accountId: Id.optional(),
    status: MovementStatus.optional(),
    descriptorKey: z.string().min(1).optional(),
    expenseKey: z.string().min(1).optional(),
  }).strict(),
  output: Page(CardMovementResource),
  http: { method: "GET", path: "/card-movements" },
  mcp: {
    name: "list_card_movements",
    description:
      "List card invoice lines, newest first: purchase date, instalment k of n, signed amount (positive a charge, negative a credit), descriptorKey, the statement id (the hash of this invoice's line), the external id (the hash of the line without its current instalment: the purchase), the expense key and the payment key (the instalment). Filter by card account, status, descriptorKey or expenseKey.",
  },
});

export const listCardMovementDescriptors = defineOperation({
  id: "finance.listCardMovementDescriptors",
  access: "read",
  input: z
    .object({
      accountId: Id.optional(),
      classified: QueryBoolean.optional(),
    })
    .strict(),
  output: z.object({ items: z.array(CardDescriptorResource) }).strict(),
  http: { method: "GET", path: "/card-movement-descriptors" },
  mcp: {
    name: "list_card_movement_descriptors",
    description:
      'List card descriptors: one per card account and descriptorKey (the normalized merchant name), with the party and financial category its purchases post as. `classified: "false"` lists the ones still to fill.',
  },
});

export const listCardMovementLinks = defineOperation({
  id: "finance.listCardMovementLinks",
  access: "read",
  input: z
    .object({
      accountId: Id.optional(),
      expenseKey: z.string().min(1).optional(),
      expenseId: Id.optional(),
    })
    .strict(),
  output: Links,
  http: { method: "GET", path: "/card-movement-links" },
  mcp: {
    name: "list_card_movement_links",
    description:
      "What posted card lines became: per expense key, its expense, and per instalment its invoice payment, settlement and the line that showed it (null until that invoice is taken in); and the transfers of invoices paid, with their statement key.",
  },
});

export const classifyCardMovementDescriptor = defineOperation({
  id: "finance.classifyCardMovementDescriptor",
  access: "write",
  input: z
    .object({
      accountId: Id,
      descriptorKey: z.string().min(1),
      partyId: Id.nullable().optional(),
      financialCategoryId: Id.nullable().optional(),
      counterAccountId: Id.nullable().optional(),
      paymentMethod: PaymentMethod.nullable().optional(),
    })
    .strict(),
  output: z
    .object({ descriptor: CardDescriptorResource, posted: z.number().int() })
    .strict(),
  http: { method: "PATCH", path: "/card-movement-descriptors" },
  mcp: {
    name: "classify_card_movement_descriptor",
    description:
      "Say what a name on a card always is: a party and an EXPENSE financial category (a purchase; with a DEDUCTION category, a refund posted as a discount), or the account the invoice is paid from (`counterAccountId`: a transfer into the card, joined with that account statement's outflow by statement key), optionally with the `paymentMethod`. Its PENDING lines post at once when eligible, and later invoices post on their own. Answers how many posted.",
  },
});

const PostedCard = z
  .object({ movement: CardMovementResource, links: Links })
  .strict();

export const postCardMovement = defineOperation({
  id: "finance.postCardMovement",
  access: "write",
  input: z.object({ id: Id }).strict(),
  output: PostedCard,
  http: { method: "POST", path: "/card-movements/:id/post" },
  mcp: {
    name: "post_card_movement",
    description:
      "Post one PENDING card purchase from its descriptor, for instance after registering the billing window it was waiting for. The first line of a purchase creates its expense (instalment amount × count) and settles one instalment into each invoice payment from the window's month on; a later instalment's line attaches to the instalment already scheduled. There is no choosing another record: the descriptor decides.",
  },
});

export const ignoreCardMovement = defineOperation({
  id: "finance.ignoreCardMovement",
  access: "write",
  input: z.object({ id: Id, reason: Reason }).strict(),
  output: CardMovementResource,
  http: { method: "POST", path: "/card-movements/:id/ignore" },
  mcp: {
    name: "ignore_card_movement",
    description:
      "Mark a PENDING card line as not a purchase, with the reason, such as the invoice payment (Pag Fatura) or a refund.",
  },
});

export const undoCardMovement = defineOperation({
  id: "finance.undoCardMovement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, reason: Reason.optional() }).strict(),
  output: CardMovementResource,
  http: { method: "POST", path: "/card-movements/:id/undo" },
  mcp: {
    name: "undo_card_movement",
    description:
      "Return a POSTED or IGNORED card line to PENDING. When no other line of its purchase remains posted, the purchase's instalment settlements are voided and its links removed; the expense stays and is reused when the purchase is posted again.",
  },
});

export const cardOperations = [
  listCardMovements,
  listCardMovementDescriptors,
  listCardMovementLinks,
  classifyCardMovementDescriptor,
  postCardMovement,
  ignoreCardMovement,
  undoCardMovement,
] as const;
