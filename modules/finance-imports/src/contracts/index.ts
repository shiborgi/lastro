/** Finance imports' operation descriptors. Browser-safe. */
import {
  MovementConsumerResource,
  MovementIntakeResult,
  MovementType,
} from "@lastro/finance/contracts";
import { Id, defineOperation } from "@lastro/kernel";
import { z } from "zod";

/* A month of a bank account is kilobytes; this bounds a mistaken upload. */
const MAX_CONTENT = 5_000_000;

export const importMovements = defineOperation({
  id: "finance-imports.importMovements",
  access: "write",
  input: z
    .object({
      accountId: Id,
      /** What the content is, such as `account-movements`; with the account it picks the consumer. */
      type: MovementType,
      /** The caller's key for the content, such as its Drive path. Provenance only. */
      key: z.string().trim().min(1).max(1000),
      content: z.string().min(1).max(MAX_CONTENT),
    })
    .strict(),
  output: MovementIntakeResult,
  http: { method: "POST", path: "/movement-imports" },
  mcp: {
    name: "import_movements",
    description:
      "Take in one content (a file's text) for an account of the Book. The Book, account and type pick the consumer that reads it (set_movement_consumer). Safe to send again: the same content answers what its first intake did, and a line whose external id was already taken in is never staged twice. Money out becomes payment_movements, money in receipt_movements; a line whose descriptor (its normalized name) is already filled, with a payment method known, is posted at once; a new name gets an empty descriptor and waits for classify_payment_movement_descriptor or classify_receipt_movement_descriptor (on /mcp/finance). Answers the counts of new, known, posted and pending lines.",
  },
});

export const setMovementConsumer = defineOperation({
  id: "finance-imports.setMovementConsumer",
  access: "write",
  input: z
    .object({
      accountId: Id,
      type: MovementType,
      /** An importer of list_movement_importers whose evidence is `type`. */
      importerId: z.string().min(1),
    })
    .strict(),
  output: MovementConsumerResource,
  http: { method: "PUT", path: "/movement-consumers" },
  mcp: {
    name: "set_movement_consumer",
    description:
      "Say which importer reads an account's content of a type, e.g. the Nubank account with type account-movements read by nubank/account. Replaces the account's consumer of that type.",
  },
});

export const listMovementConsumers = defineOperation({
  id: "finance-imports.listMovementConsumers",
  access: "read",
  input: z.object({ accountId: Id.optional() }).strict(),
  output: z.object({ items: z.array(MovementConsumerResource) }).strict(),
  http: { method: "GET", path: "/movement-consumers" },
  mcp: {
    name: "list_movement_consumers",
    description:
      "List which importer reads each account's content of each type.",
  },
});

export const listMovementImporters = defineOperation({
  id: "finance-imports.listMovementImporters",
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
  http: { method: "GET", path: "/movement-importers" },
  mcp: {
    name: "list_movement_importers",
    description:
      "List the formats Lastro reads: importer id (such as nubank/account), version, fingerprint and evidence, the content type it consumes.",
  },
});

export const financeImportsOperations = [
  importMovements,
  setMovementConsumer,
  listMovementConsumers,
  listMovementImporters,
] as const;
