/** Reading sales days: a day is derived from its posted sale lines (ADR 21). */
import {
  type BoundOperation,
  type ExecutionContext,
  type Scope,
  bind,
  dateFromText,
  textFromDate,
} from "@lastro/kernel";
import * as contracts from "../contracts/days";
import { type SaleLine, SalesDayError } from "../domain/day";
import type { SalesPort } from "./port";

type BookScope = Scope<ExecutionContext>;

const totals = (lines: readonly SaleLine[]) => ({
  revenue: lines.reduce((sum, line) => sum + line.revenue, 0n),
  cost: lines.reduce((sum, line) => sum + (line.cost ?? 0n), 0n),
  missingCost: lines
    .filter((line) => line.costSource === "MISSING")
    .map((line) => line.productId),
});

/** One posted day's totals, as other modules read them. */
export type SalesDaySummary = {
  businessDate: Date;
  currency: string;
  revenue: bigint;
  cost: bigint;
  /** Products whose line carries no cost. */
  missingCost: string[];
};

export type SalesDaysApi = {
  /** The days with posted lines within the range, in date order. */
  list(
    scope: BookScope,
    range: { from?: Date; to?: Date },
  ): Promise<SalesDaySummary[]>;
};

export function createSalesDays(port: SalesPort): {
  api: SalesDaysApi;
  handlers: BoundOperation[];
} {
  const book = (scope: BookScope) => scope.context.bookId;

  async function list(
    scope: BookScope,
    range: { from?: Date; to?: Date },
  ): Promise<SalesDaySummary[]> {
    const [days, lines] = await Promise.all([
      port.lines.days(scope.handle, book(scope), range),
      port.lines.list(scope.handle, book(scope), range),
    ]);
    return days.map((day) => ({
      businessDate: day.businessDate,
      currency: day.currency,
      ...totals(
        lines.filter(
          (line) => line.businessDate.getTime() === day.businessDate.getTime(),
        ),
      ),
    }));
  }

  return {
    api: { list },
    handlers: [
      bind(contracts.getSalesDay, async ({ scope, input }) => {
        const lines = await port.lines.list(scope.handle, book(scope), {
          businessDate: dateFromText(input.businessDate),
        });
        const [first] = lines;
        if (!first)
          throw new SalesDayError(
            "SALES_DAY_NOT_POSTED",
            `sales day ${input.businessDate} has no posted sale lines`,
            404,
          );
        return {
          businessDate: input.businessDate,
          currency: first.currency,
          ...totals(lines),
          lines: lines.map(
            ({
              bookId: _book,
              businessDate: _date,
              currency: _currency,
              ...line
            }) => line,
          ),
        };
      }),

      bind(contracts.listSalesDays, async ({ scope, input }) => ({
        items: (
          await list(scope, {
            from: input.from ? dateFromText(input.from) : undefined,
            to: input.to ? dateFromText(input.to) : undefined,
          })
        ).map((day) => ({
          businessDate: textFromDate(day.businessDate),
          currency: day.currency,
          revenue: day.revenue,
          cost: day.cost,
          missingCost: day.missingCost.length,
        })),
      })),
    ],
  };
}
