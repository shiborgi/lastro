import { z } from "zod";
import { Id, IsoDate } from "./financial";
import { PaymentMethod } from "./statements";

/*
 * Catalog entities are the foreign keys every financial record points at:
 * an agent that cannot list or create these cannot record anything at all.
 * Update schemas require at least one field so a PATCH is never a silent no-op.
 */

/*
 * Four kinds, not free text. The type decides what a movement against the
 * account can mean — a CARD is settled by paying its invoice, an ACCOUNT moves
 * cash directly — so an open string would let a typo create a fifth kind
 * nothing knows how to handle. The database carries the same CHECK.
 */
export const AccountType = z.enum(["CARD", "ACCOUNT", "INVESTMENT", "CASH"]);
export const PartyType = z.string().trim().min(1).max(60);
export const CategoryKind = z.enum(["EXPENSE", "REVENUE"]);
export const DisplayName = z.string().trim().min(1).max(200);

export const InstitutionResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    name: DisplayName,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateInstitution = z
  .object({ key: Id, name: DisplayName })
  .strict();

export const UpdateInstitution = z
  .object({ key: Id.optional(), name: DisplayName.optional() })
  .strict()
  .refine(
    (value) => value.key !== undefined || value.name !== undefined,
    "at least one field must be provided",
  );

export const AccountResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    institutionId: Id.nullable().optional(),
    /** As the institution prints it: an account number, or a card's last four. */
    number: z.string().trim().min(1).max(40).nullable().optional(),
    name: DisplayName,
    type: AccountType,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateAccount = z
  .object({
    key: Id,
    name: DisplayName,
    type: AccountType,
    institutionId: Id.nullable().optional(),
    number: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .strict();

export const UpdateAccount = z
  .object({
    key: Id.optional(),
    name: DisplayName.optional(),
    type: AccountType.optional(),
    institutionId: Id.nullable().optional(),
    number: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

export const PartyResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    name: DisplayName,
    type: PartyType,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateParty = z
  .object({ key: Id, name: DisplayName, type: PartyType })
  .strict();

export const UpdateParty = z
  .object({
    key: Id.optional(),
    name: DisplayName.optional(),
    type: PartyType.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

/*
 * Two descriptor tables, one per statement kind, deliberately not the same
 * shape. The card side has no method (every line on a credit-card invoice was
 * paid by that card) and no transfer destination (an invoice line is never a
 * transfer). See the schema for the measurements behind that.
 *
 * `key` is updatable on neither. It is derived from what the statement printed,
 * not chosen: renaming it makes the next import recompute the original, create
 * a second descriptor, and quietly stop applying this mapping — no error
 * anywhere. The movement tables also carry a foreign key to it.
 */
export const CardDescriptorResource = z
  .object({
    id: Id,
    bookId: Id,
    /** Whose statement this descriptor came from. Descriptors are per account. */
    accountId: Id,
    key: Id,
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    /** A label for the expense this promotes to. See the schema for why. */
    name: z.string().nullable().optional(),
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateCardDescriptor = z
  .object({
    accountId: Id,
    key: Id,
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .strict();

export const UpdateCardDescriptor = z
  .object({
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

export const AccountDescriptorResource = z
  .object({
    id: Id,
    bookId: Id,
    /** Whose statement this descriptor came from. Descriptors are per account. */
    accountId: Id,
    key: Id,
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    method: PaymentMethod.nullable().optional(),
    counterAccountId: Id.nullable().optional(),
    /** A label for the expense or revenue this promotes to. Never a transfer. */
    name: z.string().nullable().optional(),
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateAccountDescriptor = z
  .object({
    accountId: Id,
    key: Id,
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    method: PaymentMethod.nullable().optional(),
    counterAccountId: Id.nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .strict();

export const UpdateAccountDescriptor = z
  .object({
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    method: PaymentMethod.nullable().optional(),
    counterAccountId: Id.nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

/*
 * A card's billing cycle, one row per invoice, filled by hand.
 *
 * No statement states it: the invoice prints purchases and their dates and
 * never says which window produced them, and the boundary moves with weekends.
 * Promotion reads these to decide which invoice a purchase lands on, and the
 * database refuses two windows that overlap for one account — otherwise the
 * same purchase would file under a different invoice depending on row order.
 */
export const AccountReferenceMonthResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    referenceMonth: IsoDate,
    startDate: IsoDate,
    endDate: IsoDate,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateAccountReferenceMonth = z
  .object({
    accountId: Id,
    referenceMonth: IsoDate,
    startDate: IsoDate,
    endDate: IsoDate,
  })
  .strict()
  .refine(
    (value) => value.startDate <= value.endDate,
    "startDate must not be after endDate",
  );

export const UpdateAccountReferenceMonth = z
  .object({
    referenceMonth: IsoDate.optional(),
    startDate: IsoDate.optional(),
    endDate: IsoDate.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

/*
 * The chart of accounts nests one level: a category may sit inside a group, and
 * a group may not sit inside anything. `parentId` null means the row is a group
 * or stands alone. The database enforces the depth, the matching kind, and the
 * rule that a group holds categories rather than records.
 */
export const CategoryResource = z
  .object({
    id: Id,
    bookId: Id,
    kind: CategoryKind,
    name: DisplayName,
    parentId: Id.nullable().optional(),
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateCategory = z
  .object({
    name: DisplayName,
    kind: CategoryKind,
    parentId: Id.nullable().optional(),
  })
  .strict();

export const UpdateCategory = z
  .object({
    name: DisplayName.optional(),
    kind: CategoryKind.optional(),
    parentId: Id.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

export const AuditEventResource = z
  .object({
    id: Id,
    bookId: Id,
    actorType: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
    actorPrincipal: z.string(),
    delegatedOperator: z.string(),
    source: z.enum(["WEB", "API", "MCP", "WORKER"]),
    correlationId: z.string(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable().optional(),
    createdAt: IsoDate.optional(),
  })
  .strict();

export type InstitutionResource = z.infer<typeof InstitutionResource>;
export type AccountResource = z.infer<typeof AccountResource>;
export type PartyResource = z.infer<typeof PartyResource>;
export type CardDescriptorResource = z.infer<typeof CardDescriptorResource>;
export type AccountDescriptorResource = z.infer<
  typeof AccountDescriptorResource
>;
export type AccountReferenceMonthResource = z.infer<
  typeof AccountReferenceMonthResource
>;
export type CategoryResource = z.infer<typeof CategoryResource>;
export type AuditEventResource = z.infer<typeof AuditEventResource>;
