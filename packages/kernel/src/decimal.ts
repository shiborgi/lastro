/**
 * Decimal text to exact integers. No `number` is ever created (ADR 4): the
 * text is split and rounded with `BigInt`, half away from zero.
 */
import { InvalidMoneyError } from "./errors";

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function split(text: string): { negative: boolean; int: string; frac: string } {
  const match = DECIMAL.exec(text);
  if (!match || (!match[2] && !match[3])) {
    throw new InvalidMoneyError(`invalid decimal: ${JSON.stringify(text)}`);
  }
  return {
    negative: match[1] === "-",
    int: match[2] ?? "",
    frac: match[3] ?? "",
  };
}

/** Scaled magnitude of `int.frac` at `scale` places, rounded half up. */
function scaled(int: string, frac: string, scale: number): bigint {
  const padded = frac.padEnd(scale + 1, "0");
  const kept = BigInt((int || "0") + padded.slice(0, scale));
  return padded.charCodeAt(scale) >= 53 ? kept + 1n : kept;
}

/** `"2168.7000000000003"` → `216870n`; half away from zero; no exponent. */
export function toMinorUnits(text: string, scale = 2): bigint {
  const { negative, int, frac } = split(text);
  const value = scaled(int, frac, scale);
  return negative ? -value : value;
}

/** Quantity text to at most six places, no trailing zeros. */
export function normalizeQuantity(text: string): string {
  const { negative, int, frac } = split(text);
  if (negative && /[1-9]/.test(int + frac)) {
    throw new InvalidMoneyError(`quantity cannot be negative: ${text}`);
  }
  const digits = scaled(int, frac, 6).toString().padStart(7, "0");
  const whole = digits.slice(0, -6);
  const part = digits.slice(-6).replace(/0+$/, "");
  return part ? `${whole}.${part}` : whole;
}
