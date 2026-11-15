/**
 * The primitives every module's contracts are built from, and the one
 * conversion from a domain value to its wire shape.
 *
 * Money crosses the wire as a decimal string of minor units, never a number
 * (ADR 4). A date-only fact is `YYYY-MM-DD`; an instant is ISO-8601 with a
 * zone. Both surfaces serialize through `toWire`, so they cannot drift.
 */
import { z } from "zod";

export const Id = z.string().trim().min(1);

export const Amount = z
  .string()
  .regex(/^\d+$/, "must be a decimal amount string");

/* A deduction revenue or a discount expense carries a negative amount. */
export const SignedAmount = z
  .string()
  .regex(/^-?\d+$/, "must be a signed decimal amount string");

export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "must be a three-letter uppercase currency code");

export const IsoDate = z.string().datetime();
export const CalendarDate = z.string().date();

/** A calendar date, also accepted as the ISO instant a date picker may send. */
export const CalendarDateInput = z
  .union([CalendarDate, IsoDate])
  .transform((value) => value.slice(0, 10));

export const CursorPage = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type CursorPage = z.infer<typeof CursorPage>;

export const Page = <T extends z.ZodType>(item: T) =>
  z
    .object({ items: z.array(item), nextCursor: z.string().nullable() })
    .strict();
export type Page<T> = { items: T[]; nextCursor: string | null };

export const ErrorResponse = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

/** Wire text to minor units. */
export function toAmount(input: string): bigint {
  return BigInt(SignedAmount.parse(input));
}

/* Date-typed fields that hold a calendar date without the `On` suffix. */
const DATE_ONLY_FIELDS = new Set(["referenceMonth", "businessDate"]);

function isDateOnly(key: string | undefined): boolean {
  return key !== undefined && (key.endsWith("On") || DATE_ONLY_FIELDS.has(key));
}

/**
 * A domain value as JSON-safe data: `bigint` becomes a decimal string, a
 * `Date` becomes `YYYY-MM-DD` under a date-only field name and ISO-8601
 * elsewhere, and `undefined` members are dropped.
 */
export function toWire(value: unknown, key?: string): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString();
    return isDateOnly(key) ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value)) return value.map((item) => toWire(item, key));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [name, member] of Object.entries(value)) {
      if (member !== undefined) out[name] = toWire(member, name);
    }
    return out;
  }
  return value;
}

/** One page of `items` in id order, after `cursor`. */
export function paginate<T extends { id: string }>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): Page<T> {
  const sorted = [...items].sort(
    (left, right) => Number(left.id) - Number(right.id),
  );
  const start = cursor
    ? Math.max(0, sorted.findIndex((item) => item.id === cursor) + 1)
    : 0;
  const result = sorted.slice(start, start + limit);
  return {
    items: result,
    nextCursor: result.length === limit ? (result.at(-1)?.id ?? null) : null,
  };
}
