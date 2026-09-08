/*
 * The wire shape of a persisted record: serial ids become strings, bigint
 * amounts become decimal strings, and Dates become ISO-8601. API and MCP both
 * parse through this so the two surfaces cannot drift — the read-parity
 * integration test asserts exactly that.
 */

const ID_FIELDS = [
  "accountId",
  "categoryId",
  "expenseId",
  "paymentId",
  "revenueId",
  "receiptId",
  "institutionId",
  "sourceAccountId",
  "destinationAccountId",
  "correlationId",
] as const;

/* Dates that may legitimately be null and must keep that null on the wire. */
const NULLABLE_DATE_FIELDS = ["referenceMonth", "paidAt", "voidedAt"] as const;

/* Dates that are either a real timestamp or absent — never a raw string. */
const REQUIRED_DATE_FIELDS = ["occurredAt", "dueAt", "createdAt"] as const;

export function normalizeResource(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };

  out.id = String(value.id);
  out.bookId = String(value.bookId);
  // Nullable by design: an unresolved party alias keeps partyId null.
  out.partyId = value.partyId == null ? value.partyId : String(value.partyId);
  out.amount = value.amount === undefined ? undefined : String(value.amount);

  for (const field of ID_FIELDS) {
    const current = value[field];
    out[field] =
      current === undefined || current === null ? current : String(current);
  }

  for (const field of NULLABLE_DATE_FIELDS) {
    out[field] =
      value[field] instanceof Date
        ? (value[field] as Date).toISOString()
        : value[field];
  }

  for (const field of REQUIRED_DATE_FIELDS) {
    out[field] =
      value[field] instanceof Date
        ? (value[field] as Date).toISOString()
        : undefined;
  }

  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}
