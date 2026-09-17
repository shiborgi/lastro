import { paymentMethods } from "@lastro/domain";
import { z } from "zod";
import { Amount, Id, IsoDate, SignedAmount } from "./financial";

/*
 * Staging a bank export, and reviewing what it staged.
 *
 * Everything here describes what a file *said*, never what it means. A staged
 * row is not an expense and does not become one by being listed: promotion is
 * a separate, separately authorized step (ADR 8).
 */

export const MovementStatus = z.enum(["PENDING", "IGNORED", "POSTED"]);
/*
 * Derived from the domain's list rather than repeating it. The wire schema and
 * the rule it validates against were two literals that had to be kept equal by
 * hand; deriving makes adding a rail one edit instead of three.
 */
export const PaymentMethod = z.enum(paymentMethods);
export const MovementKind = z.enum(["card", "account"]);

/**
 * The storage path, which is also how the institution and the format are
 * chosen: `<institution>/<kind>/<file>`. The first segment is matched against
 * `institutions.key` in the Book and the import refuses an unknown one rather
 * than creating it.
 */
export const StatementPath = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine(
    (value) => value.split("/").filter(Boolean).length >= 3,
    "path must be <institution>/<kind>/<file>",
  );

export const ImportStatement = z
  .object({
    path: StatementPath,
    /*
     * Which account this file is. Required and not inferred: the Nubank export
     * prints no account number, and a C6 invoice carries two card numbers that
     * are two plastics on one credit account. Guessing it from a row would be
     * wrong on both counts, and silently.
     */
    accountId: Id,
    // The file itself. The caller transports the bytes; it never interprets
    // them — parsing lives beside the ledger so every caller reads a format
    // the same way.
    content: z.string().min(1).max(20_000_000),
  })
  .strict();

export const ImportSummary = z
  .object({
    institutionKey: z.string(),
    kind: MovementKind,
    source: z.string(),
    rows: z.number().int().min(0),
    inserted: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    newDescriptors: z.number().int().min(0),
    methodUndecided: z.number().int().min(0),
  })
  .strict();

export const CardMovementResource = z
  .object({
    id: Id,
    bookId: Id,
    institutionId: Id,
    /** The account this file belongs to, stated at import. */
    accountId: Id,
    source: z.string(),
    key: z.string(),
    occurrence: z.number().int().min(1),
    purchaseDate: IsoDate,
    cardholder: z.string().nullable().optional(),
    cardNumber: z.string().nullable().optional(),
    /** The issuer's own category, verbatim. Never a Lastro category. */
    category: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string(),
    descriptorKey: z.string(),
    installmentNumber: z.number().int().nullable().optional(),
    installmentCount: z.number().int().nullable().optional(),
    amount: SignedAmount,
    currency: z.string(),
    status: MovementStatus,
    expenseId: Id.nullable().optional(),
    revenueId: Id.nullable().optional(),
    transferId: Id.nullable().optional(),
  })
  .strict();

export const AccountMovementResource = z
  .object({
    id: Id,
    bookId: Id,
    institutionId: Id,
    /** See `CardMovementResource.accountId`. */
    accountId: Id,
    source: z.string(),
    key: z.string(),
    occurrence: z.number().int().min(1),
    purchaseDate: IsoDate,
    branch: z.string().nullable().optional(),
    accountNumber: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string(),
    descriptorKey: z.string(),
    amount: SignedAmount,
    currency: z.string(),
    status: MovementStatus,
    expenseId: Id.nullable().optional(),
    revenueId: Id.nullable().optional(),
    transferId: Id.nullable().optional(),
  })
  .strict();

/*
 * POSTED is deliberately not accepted. Marking a row posted without creating
 * the expense behind it would leave the ledger claiming money it never
 * recorded; the database refuses it too, via a CHECK.
 */
export const ReviewMovement = z
  .object({
    kind: MovementKind,
    id: Id,
    status: z.enum(["PENDING", "IGNORED"]),
  })
  .strict();

/**
 * A descriptor still missing a destination, with the evidence for deciding.
 *
 * `sourceCategories` is the institution's own classification, offered as a hint
 * and never applied — a real invoice files "BRASTEMP BY CULLIGAN" under
 * *Aluguel*. `method` is the one field the import may have pre-filled from the
 * line's wording; a null means the statement said nothing about it.
 */
/*
 * `referenceMonth` is required and not derived. It belongs to the invoice, not
 * the purchase — an instalment bought in April lands on a September statement —
 * so the caller states it and the ledger never guesses.
 */
export const PostMovement = z
  .object({ kind: MovementKind, id: Id, referenceMonth: IsoDate })
  .strict();

/**
 * The same call over HTTP, where `kind` and `id` are already in the path.
 *
 * Its own contract rather than a reuse of `PostMovement`, which is shaped for a
 * tool call — there all three really are arguments. The REST route parsed the
 * *body* with that one and so demanded two fields no request could carry, which
 * made every promotion from a browser a 400 naming `kind` and `id` as missing.
 * Nothing caught it: the route compiled, and there was no promote button on the
 * screen to fail. `.strict()` stays, because it is what turns a wrong body into
 * that refusal instead of a record dated the epoch.
 */
export const PostMovementBody = z.object({ referenceMonth: IsoDate }).strict();

export const PostedMovement = z
  .object({
    kind: z.enum(["expense", "revenue", "transfer"]),
    id: Id,
    amount: Amount,
    method: PaymentMethod.nullable(),
  })
  .strict();

/**
 * What the summary reads. Money crosses as signed decimal strings; the daily
 * series carries only what an account statement records, because an invoice
 * line dates the purchase rather than the payment.
 */
export const BookInsightsResource = z
  .object({
    gap: z
      .object({
        stagedMovements: z.number().int().min(0),
        postedMovements: z.number().int().min(0),
        ledgerRecords: z.number().int().min(0),
        /** Both sides together, for the headline. */
        descriptors: z.number().int().min(0),
        descriptorsPending: z.number().int().min(0),
        /** Per side, because the review bench is split into card and account. */
        cardDescriptors: z.number().int().min(0),
        cardDescriptorsPending: z.number().int().min(0),
        accountDescriptors: z.number().int().min(0),
        accountDescriptorsPending: z.number().int().min(0),
      })
      .strict(),
    cash: z.array(
      z
        .object({
          source: z.string(),
          days: z.array(
            z
              .object({
                date: IsoDate,
                inflow: Amount,
                outflow: Amount,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    byGroup: z.array(
      z
        .object({
          group: z.string().nullable(),
          category: z.string(),
          kind: z.enum(["EXPENSE", "REVENUE"]),
          total: SignedAmount,
          count: z.number().int().min(1),
        })
        .strict(),
    ),
  })
  .strict();

/*
 * A descriptor nobody has finished mapping, with the evidence for deciding:
 * how many movements point at it, what they add up to, when they ran, and how
 * the institution itself classified them. `sourceCategories` is a hint and
 * never an answer — a real invoice files "BRASTEMP BY CULLIGAN" under Aluguel.
 */
const pendingEvidence = {
  movements: z.number().int().min(0),
  total: SignedAmount,
  firstSeen: IsoDate.nullable(),
  lastSeen: IsoDate.nullable(),
  sourceCategories: z.array(
    z.object({ value: z.string(), count: z.number().int().min(1) }).strict(),
  ),
};

export const PendingCardDescriptorResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    key: z.string(),
    partyId: Id.nullable(),
    categoryId: Id.nullable(),
    name: z.string().nullable(),
    ...pendingEvidence,
  })
  .strict();

export const PendingAccountDescriptorResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    key: z.string(),
    partyId: Id.nullable(),
    categoryId: Id.nullable(),
    method: PaymentMethod.nullable(),
    counterAccountId: Id.nullable(),
    name: z.string().nullable(),
    ...pendingEvidence,
  })
  .strict();

/**
 * A staged movement as JSON: dates to ISO, `bigint` to a decimal string, ids to
 * strings, and the two bookkeeping timestamps dropped.
 *
 * It lives in contracts rather than in one transport because both the MCP tools
 * and the HTTP API serialise the same rows, and a second copy would be free to
 * drift — the resource schemas are `.strict()`, so a divergence surfaces as an
 * opaque INVALID_REQUEST rather than as a wrong field.
 */
export function movementResource(value: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(value)) {
    if (field === "createdAt" || field === "importedAt") continue;
    if (raw === null || raw === undefined) {
      out[field] = raw;
    } else if (raw instanceof Date) {
      out[field] = raw.toISOString();
    } else if (typeof raw === "bigint") {
      out[field] = raw.toString();
    } else if (
      field === "id" ||
      field === "bookId" ||
      field === "institutionId" ||
      field === "expenseId"
    ) {
      out[field] = String(raw);
    } else {
      out[field] = raw;
    }
  }
  return out;
}
