import { defineOperation } from "@lastro/kernel";
/** Sales imports' operation descriptors. Browser-safe (ADRs 13 and 21). */
import {
  SaleConsumerResource,
  SaleIntakeResult,
  SaleType,
} from "@lastro/sales/contracts";
import { z } from "zod";

/* A day of a point of sale is kilobytes; this bounds a mistaken upload. */
const MAX_CONTENT = 5_000_000;

export const importSales = defineOperation({
  id: "sales-imports.importSales",
  access: "write",
  input: z
    .object({
      /** What the content is, such as `sale-movements`; it picks the consumer. */
      type: SaleType,
      /** The caller's key for the content, such as its Drive path. Provenance only. */
      key: z.string().trim().min(1).max(1000),
      content: z.string().min(1).max(MAX_CONTENT),
    })
    .strict(),
  output: SaleIntakeResult,
  http: { method: "POST", path: "/sale-imports" },
  mcp: {
    name: "import_sales",
    description:
      "Take in one sales content (a point of sale's products sold on a day). The Book and type pick the consumer that reads it (set_sale_consumer). Safe to send again: the same content answers what its first intake did, and a line already taken in is never staged twice. Each line becomes a sale_movement; one whose descriptor (its product code) names a product posts at once as a sale line; a new code gets an empty descriptor and waits for classify_sale_movement_descriptor. Answers the counts of new, known, posted and pending lines.",
  },
});

export const setSaleConsumer = defineOperation({
  id: "sales-imports.setSaleConsumer",
  access: "write",
  input: z
    .object({
      type: SaleType,
      /** An importer of list_sale_importers whose evidence is `type`. */
      importerId: z.string().min(1),
    })
    .strict(),
  output: SaleConsumerResource,
  http: { method: "PUT", path: "/sale-consumers" },
  mcp: {
    name: "set_sale_consumer",
    description:
      "Say which importer reads the Book's sales content of a type, e.g. type sale-movements read by yooga/sales. Replaces the consumer of that type.",
  },
});

export const listSaleConsumers = defineOperation({
  id: "sales-imports.listSaleConsumers",
  access: "read",
  input: z.object({}).strict(),
  output: z.object({ items: z.array(SaleConsumerResource) }).strict(),
  http: { method: "GET", path: "/sale-consumers" },
  mcp: {
    name: "list_sale_consumers",
    description: "List which importer reads each type of sales content.",
  },
});

export const listSaleImporters = defineOperation({
  id: "sales-imports.listSaleImporters",
  access: "read",
  input: z.object({}).strict(),
  output: z
    .object({
      items: z.array(
        z
          .object({
            id: z.string(),
            version: z.number().int(),
            fingerprint: z.string(),
            evidence: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
  http: { method: "GET", path: "/sale-importers" },
  mcp: {
    name: "list_sale_importers",
    description:
      "List the sales formats Lastro reads: importer id (such as yooga/sales), version, fingerprint and evidence, the content type it consumes.",
  },
});

export const salesImportsOperations = [
  importSales,
  setSaleConsumer,
  listSaleConsumers,
  listSaleImporters,
] as const;
