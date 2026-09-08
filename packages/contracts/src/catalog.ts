import { z } from "zod";
import { Id, IsoDate } from "./financial";

/*
 * Catalog entities are the foreign keys every financial record points at:
 * an agent that cannot list or create these cannot record anything at all.
 * Update schemas require at least one field so a PATCH is never a silent no-op.
 */

export const AccountType = z.string().trim().min(1).max(60);
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
  })
  .strict();

export const UpdateAccount = z
  .object({
    key: Id.optional(),
    name: DisplayName.optional(),
    type: AccountType.optional(),
    institutionId: Id.nullable().optional(),
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

export const PartyAliasResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    key: Id,
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreatePartyAlias = z
  .object({
    key: Id,
    accountId: Id,
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
  })
  .strict();

export const UpdatePartyAlias = z
  .object({
    key: Id.optional(),
    accountId: Id.optional(),
    partyId: Id.nullable().optional(),
    categoryId: Id.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field must be provided",
  );

export const CategoryResource = z
  .object({
    id: Id,
    bookId: Id,
    kind: CategoryKind,
    name: DisplayName,
    createdAt: IsoDate.optional(),
  })
  .strict();

export const CreateCategory = z
  .object({ name: DisplayName, kind: CategoryKind })
  .strict();

export const UpdateCategory = z
  .object({ name: DisplayName.optional(), kind: CategoryKind.optional() })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.kind !== undefined,
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
export type PartyAliasResource = z.infer<typeof PartyAliasResource>;
export type CategoryResource = z.infer<typeof CategoryResource>;
export type AuditEventResource = z.infer<typeof AuditEventResource>;
