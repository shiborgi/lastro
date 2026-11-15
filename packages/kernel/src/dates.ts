/**
 * Calendar dates across the three shapes they take: `YYYY-MM-DD` text on the
 * wire, a UTC-midnight `Date` in a `date` column, and back.
 *
 * A date-only fact never gains a time (ADR 13): the UTC midnight is how the
 * driver represents a `date`, not an instant anyone observed.
 */
import { InvalidDateError } from "./errors";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `"2026-11-07"` → the UTC-midnight Date a `date` column takes. */
export function dateFromText(text: string): Date {
  const date = new Date(`${text}T00:00:00Z`);
  if (
    !DATE.test(text) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw new InvalidDateError(text);
  }
  return date;
}

/** A `date` column's value → `"2026-11-07"`. */
export function textFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
