/**
 * The derived daily close (ADR 21): what a posted day sold and cost, and its
 * share of the month's fixed costs. Nothing here is stored; it is computed on every read.
 */

/**
 * One posted day's slice of the month's fixed cost. The base divides evenly
 * among the month's posted days and the remainder goes one cent each to the
 * earliest, so a closed month's shares add up to its fixed cost exactly. An
 * open month with nothing recorded yet borrows the previous month's total.
 */
export function fixedCostShare(input: {
  monthFixed: bigint;
  previousMonthFixed: bigint;
  openDays: number;
  dayIndex: number;
  monthClosed: boolean;
}): { share: bigint; provisional: boolean } {
  const provisional = !input.monthClosed;
  if (input.openDays <= 0) return { share: 0n, provisional };
  if (
    !Number.isInteger(input.dayIndex) ||
    input.dayIndex < 0 ||
    input.dayIndex >= input.openDays
  )
    throw new RangeError(
      `dayIndex ${input.dayIndex} is not one of the month's ${input.openDays} open days`,
    );
  const base =
    input.monthFixed === 0n && !input.monthClosed
      ? input.previousMonthFixed
      : input.monthFixed;
  const days = BigInt(input.openDays);
  const negative = base < 0n;
  const magnitude = negative ? -base : base;
  const share =
    magnitude / days + (BigInt(input.dayIndex) < magnitude % days ? 1n : 0n);
  return { share: negative ? -share : share, provisional };
}

export type DailyClose = {
  businessDate: string;
  currency: string;
  sold: bigint;
  cost: bigint;
  missingCost: string[];
  fixedShare: bigint;
  result: bigint;
  /** True while the month's fixed costs are not final. */
  provisional: boolean;
};
