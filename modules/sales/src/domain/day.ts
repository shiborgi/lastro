/**
 * The sales day: the operational day it covers and the cost each line
 * carries.
 *
 * Money is `bigint` minor units; quantities are decimal text scaled with
 * `BigInt`, never `number`. Rounding is half away from zero.
 */
import {
  InvalidDateError,
  LastroError,
  addDays,
  dateFromText,
  normalizeQuantity,
} from "@lastro/kernel";

/* Where a line's cost came from: the Book's catalog override, the day's report, or nowhere. */
export const costSources = ["CATALOG", "SALE", "MISSING"] as const;
export type CostSource = (typeof costSources)[number];

export type SaleLine = {
  id: string;
  bookId: string;
  businessDate: Date;
  currency: string;
  productId: string;
  /** Exact decimal text, up to six places. */
  quantity: string;
  revenue: bigint;
  unitCost: bigint | null;
  cost: bigint | null;
  costSource: CostSource;
};

/** A day with posted lines; it is derived from them, never stored. */
export type SalesDay = {
  bookId: string;
  businessDate: Date;
  currency: string;
};

export class SalesDayError extends LastroError {
  constructor(
    code: string,
    message: string,
    status = 409,
    details?: Record<string, unknown>,
  ) {
    super(code, message, status, details);
    this.name = "SalesDayError";
  }
}

/** `numerator / denominator`, half away from zero; the denominator is positive. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

const MICROS = 1_000_000n;

/** Quantity text as an integer count of millionths. */
export function quantityMicros(quantity: string): bigint {
  const [whole = "0", fraction = ""] = normalizeQuantity(quantity).split(".");
  return BigInt(whole + fraction.padEnd(6, "0"));
}

/**
 * Which cost a line carries: the product's override (the unit cost the Book
 * stands behind), else the line total the day reported, else none.
 */
export function chooseCost(input: {
  quantity: string;
  reportedCost: bigint | null;
  costOverride: bigint | null;
}): { unitCost: bigint | null; cost: bigint | null; costSource: CostSource } {
  const micros = quantityMicros(input.quantity);
  let cost: bigint;
  let costSource: CostSource;
  if (input.costOverride !== null) {
    cost = divRound(input.costOverride * micros, MICROS);
    costSource = "CATALOG";
  } else if (input.reportedCost !== null && input.reportedCost > 0n) {
    cost = input.reportedCost;
    costSource = "SALE";
  } else return { unitCost: null, cost: null, costSource: "MISSING" };
  return {
    unitCost: micros === 0n ? null : divRound(cost * MICROS, micros),
    cost,
    costSource,
  };
}

const ZONE = "America/Sao_Paulo";

/** Offset (ms) of São Paulo from UTC at the given instant. */
function zoneOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** The instant an operational day closes: 06:00 São Paulo of the next day (ADRs 13 and 21). */
export function operationalDayCloseInstant(businessDate: string): Date {
  const day = dateFromText(businessDate);
  const wall = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate() + 1,
    6,
    0,
    0,
  );
  const first = wall - zoneOffsetMs(wall);
  return new Date(wall - zoneOffsetMs(first));
}

export function operationalDayClosed(businessDate: string, now: Date): boolean {
  return now.getTime() >= operationalDayCloseInstant(businessDate).getTime();
}

/** The business day an instant belongs to: before 06:00 local it is still the previous day. */
export function businessDateOf(at: Date): string {
  const wall = new Date(at.getTime() + zoneOffsetMs(at.getTime()))
    .toISOString()
    .slice(0, 10);
  const previous = addDays(wall, -1);
  return at.getTime() < operationalDayCloseInstant(previous).getTime()
    ? previous
    : wall;
}

export function assertBusinessDate(value: string): string {
  try {
    dateFromText(value);
  } catch {
    throw new InvalidDateError(value);
  }
  return value;
}
