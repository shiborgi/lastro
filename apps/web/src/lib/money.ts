/*
 * Amounts cross the wire as integer strings in the currency's minor unit, so
 * they never touch a float. Formatting is the only place they become decimal.
 */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  VND: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

function minorUnitDigits(currency: string): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;
}

/**
 * The inverse of `formatAmount`'s decimal side: what an operator types
 * (`"1200.00"`) into the minor-unit integer string the wire expects
 * (`"120000"`). Stays on strings throughout — no `Number`, no float division
 * — the same reason `postgres`'s `bigint` mode and every `Amount` field
 * cross the wire as a string rather than a JSON number.
 *
 * `null` means the input was not a plain, non-negative decimal, or carried
 * more fractional digits than the currency's minor unit allows — a screen
 * shows that as a validation message rather than sending a guess.
 */
export function parseAmount(input: string, currency: string): string | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const digits = minorUnitDigits(currency);
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > digits) return null;
  const minor = `${whole}${fraction.padEnd(digits, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  return minor === "" ? "0" : minor;
}

/**
 * What an operator types in a pt-BR field: `"12,50"`, `"1.234,50"` or a plain
 * `"12.50"`. With a comma present the dots are thousands separators; without
 * one the input is the point-decimal `parseAmount` already takes.
 */
export function parseTypedAmount(
  input: string,
  currency: string,
): string | null {
  const raw = input.trim();
  const typed = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  return parseAmount(typed, currency);
}

export function formatAmount(amount: string, currency: string): string {
  const digits = minorUnitDigits(currency);
  const negative = amount.startsWith("-");
  const raw = (negative ? amount.slice(1) : amount).padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, -digits);
  const fraction = digits === 0 ? "" : raw.slice(-digits);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const value = fraction ? `${grouped}.${fraction}` : grouped;
  return `${negative ? "-" : ""}${value} ${currency.toUpperCase()}`;
}

/**
 * Minor units as a column of statement money: pt-BR grouping, a real minus
 * sign, no currency code.
 *
 * `formatAmount` above is the record-facing form, where the code is the point
 * because a ledger holds more than one currency. On a statement screen every
 * row is the same currency, so repeating it says nothing — this drops it and
 * spends the space on alignment.
 *
 * Arithmetic stays on strings, like everything else in this file. The local
 * helper this replaces did `Number(cents) / 100`, which is a float: fine for a
 * grocery bill, wrong above 2^53, and not worth leaving in a ledger.
 */
export function formatStatementAmount(
  amount: string,
  currency = "BRL",
): string {
  const digits = minorUnitDigits(currency);
  const negative = amount.startsWith("-");
  const raw = (negative ? amount.slice(1) : amount).padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, -digits);
  const fraction = digits === 0 ? "" : raw.slice(-digits);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  // U+2212, not a hyphen: it is the width of a digit, so the column stays true.
  return `${negative ? "−" : ""}${fraction ? `${grouped},${fraction}` : grouped}`;
}
