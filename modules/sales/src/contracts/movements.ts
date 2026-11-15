/** Sales evidence on the wire (ADR 21). Browser-safe. */
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
import { SaleLineResource } from "./days";

export const SaleMovementStatus = z.enum(["PENDING", "POSTED", "IGNORED"]);
/** The kind of sales content a consumer reads, such as `sale-movements`. */
export const SaleType = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,49}$/, "a lowercase type such as sale-movements");
const Reason = z.string().trim().min(1).max(500);
/* Query booleans are explicit text: a coerced "false" is true. */
const QueryBoolean = z.enum(["true", "false"]).transform((v) => v === "true");

export const SaleConsumerResource = z
  .object({
    bookId: Id,
    movementType: SaleType,
    importerId: z.string(),
    setBy: z.string(),
    setAt: IsoDate,
  })
  .strict();

export const SaleFileResource = z
  .object({
    id: Id,
    bookId: Id,
    movementType: SaleType,
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

export const SaleMovementDescriptorResource = z
  .object({
    bookId: Id,
    descriptorKey: z.string(),
    name: z.string(),
    productId: Id.nullable(),
  })
  .strict();

export const SaleMovementResource = z
  .object({
    id: Id,
    bookId: Id,
    fileId: Id,
    externalId: z.string(),
    businessDate: CalendarDate,
    code: z.string().nullable(),
    name: z.string(),
    /** The point of sale's own category, as printed; never the Book's product category. */
    providerCategory: z.string().nullable(),
    descriptorKey: z.string(),
    quantity: z.string(),
    revenue: Amount,
    cost: Amount.nullable(),
    currency: Currency,
    status: SaleMovementStatus,
    ignoreReason: z.string().nullable(),
  })
  .strict();

export const SaleMovementLinkResource = z
  .object({
    bookId: Id,
    movementId: Id,
    externalKey: z.string(),
    saleKey: z.string(),
    saleId: Id,
  })
  .strict();

/** What one intake did; also answered, unchanged, for content taken in before. */
export const SaleIntakeResult = z
  .object({
    file: SaleFileResource,
    alreadyImported: z.boolean(),
    lines: z.number().int(),
    new: z.number().int(),
    known: z.number().int(),
    posted: z.number().int(),
    pending: z.number().int(),
  })
  .strict();

export const listSaleFiles = defineOperation({
  id: "sales.listSaleFiles",
  access: "read",
  input: CursorPage.strict(),
  output: Page(SaleFileResource),
  http: { method: "GET", path: "/sale-files" },
  mcp: {
    name: "list_sale_files",
    description:
      "List the sales contents taken in, newest first: type, importer, content hash, source key, lines and how many were new.",
  },
});

export const listSaleMovements = defineOperation({
  id: "sales.listSaleMovements",
  access: "read",
  input: CursorPage.extend({
    status: SaleMovementStatus.optional(),
    descriptorKey: z.string().min(1).optional(),
    businessDate: CalendarDate.optional(),
  }).strict(),
  output: Page(SaleMovementResource),
  http: { method: "GET", path: "/sale-movements" },
  mcp: {
    name: "list_sale_movements",
    description:
      "List sale movements (one product of one day as the point of sale printed it), newest first: day, code, name, quantity, revenue, reported cost, status. Filter by status (PENDING, POSTED, IGNORED), descriptorKey or businessDate.",
  },
});

export const listSaleMovementDescriptors = defineOperation({
  id: "sales.listSaleMovementDescriptors",
  access: "read",
  input: z.object({ classified: QueryBoolean.optional() }).strict(),
  output: z.object({ items: z.array(SaleMovementDescriptorResource) }).strict(),
  http: { method: "GET", path: "/sale-movement-descriptors" },
  mcp: {
    name: "list_sale_movement_descriptors",
    description:
      'List the sale descriptors: one per point-of-sale product code (its normalized code, or name when it has none), with the Book\'s product it posts as. `classified: "false"` lists the ones still to classify.',
  },
});

export const classifySaleMovementDescriptor = defineOperation({
  id: "sales.classifySaleMovementDescriptor",
  access: "write",
  input: z.object({ descriptorKey: z.string().min(1), productId: Id }).strict(),
  output: z
    .object({
      descriptor: SaleMovementDescriptorResource,
      posted: z.number().int(),
    })
    .strict(),
  http: { method: "PATCH", path: "/sale-movement-descriptors" },
  mcp: {
    name: "classify_sale_movement_descriptor",
    description:
      "Say which product of the Book a point-of-sale product code always is. Every PENDING movement of the descriptor is posted at once as a sale line, and later contents post on their own. Answers how many were posted.",
  },
});

export const listSaleMovementLinks = defineOperation({
  id: "sales.listSaleMovementLinks",
  access: "read",
  input: z
    .object({
      movementId: Id.optional(),
      externalKey: z.string().min(1).optional(),
      saleKey: z.string().min(1).optional(),
      saleId: Id.optional(),
    })
    .strict()
    .refine(
      (value) => Object.values(value).some((each) => each !== undefined),
      "name movementId, externalKey, saleKey or saleId",
    ),
  output: z.object({ items: z.array(SaleMovementLinkResource) }).strict(),
  http: { method: "GET", path: "/sale-movement-links" },
  mcp: {
    name: "list_sale_movement_links",
    description:
      "The sale lines posted movements became. Every link has `externalKey` (the movement's external id, the hash of its line) and `saleKey` (`<externalKey>-sale`), the line's own key. Find them by movement, external key, sale key or sale line.",
  },
});

export const postSaleMovement = defineOperation({
  id: "sales.postSaleMovement",
  access: "write",
  input: z.object({ id: Id }).strict(),
  output: z
    .object({
      movement: SaleMovementResource,
      line: SaleLineResource,
      link: SaleMovementLinkResource,
    })
    .strict(),
  http: { method: "POST", path: "/sale-movements/:id/post" },
  mcp: {
    name: "post_sale_movement",
    description:
      "Post one PENDING sale movement as a sale line of its day, as the product its descriptor names. There is no choosing another product: the descriptor decides.",
  },
});

export const ignoreSaleMovement = defineOperation({
  id: "sales.ignoreSaleMovement",
  access: "write",
  input: z.object({ id: Id, reason: Reason }).strict(),
  output: SaleMovementResource,
  http: { method: "POST", path: "/sale-movements/:id/ignore" },
  mcp: {
    name: "ignore_sale_movement",
    description:
      "Mark a PENDING sale movement as deliberately not a sale, with the reason.",
  },
});

export const undoSaleMovement = defineOperation({
  id: "sales.undoSaleMovement",
  access: "write",
  destructive: true,
  input: z.object({ id: Id, reason: Reason.optional() }).strict(),
  output: SaleMovementResource,
  http: { method: "POST", path: "/sale-movements/:id/undo" },
  mcp: {
    name: "undo_sale_movement",
    description:
      "Return a POSTED or IGNORED sale movement to PENDING; a posted one's sale line is removed.",
  },
});

export const movementOperations = [
  listSaleFiles,
  listSaleMovements,
  listSaleMovementDescriptors,
  classifySaleMovementDescriptor,
  listSaleMovementLinks,
  postSaleMovement,
  ignoreSaleMovement,
  undoSaleMovement,
] as const;
