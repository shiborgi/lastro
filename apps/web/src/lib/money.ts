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

export function minorUnitDigits(currency: string): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;
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

/** Decimal input from a form back into the minor-unit integer string. */
export function toMinorUnits(input: string, currency: string): string {
  const digits = minorUnitDigits(currency);
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("amount must be a positive decimal number");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > digits) {
    throw new Error(`${currency} allows at most ${digits} decimal places`);
  }
  return `${whole}${fraction.padEnd(digits, "0")}`.replace(/^0+(?=\d)/, "");
}
