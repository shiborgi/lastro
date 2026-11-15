/**
 * Money as text for messages. No imports, so the error vocabulary can use it
 * without a cycle back through the modules that throw those errors.
 */

/** `-150n` → `"-1.50"`. */
export function formatCents(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
