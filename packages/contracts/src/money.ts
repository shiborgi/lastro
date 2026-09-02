import { z } from "zod";

/**
 * Money at JSON/MCP boundaries is a decimal string representing minor units (e.g. cents).
 * Never a JS number.
 */
export const Money = z
  .string()
  .regex(
    /^-?\d+$/,
    'money must be a decimal minor-unit string (e.g. "100" for 1.00)',
  )
  .transform((s) => BigInt(s));

export type Money = z.infer<typeof Money>;

export function toMinorUnits(input: unknown): bigint {
  return Money.parse(input);
}

export function fromMinorUnits(minor: bigint): string {
  return minor.toString();
}
