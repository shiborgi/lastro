/** The derived daily close: read only, from sales' days and finance's fixed expenses. */
import type { FinanceApi } from "@lastro/finance";
import {
  type BoundOperation,
  type ExecutionContext,
  LastroError,
  type Scope,
  bind,
  dateFromText,
  textFromDate,
} from "@lastro/kernel";
import {
  type SalesApi,
  type SalesDaySummary,
  operationalDayClosed,
} from "@lastro/sales";
import * as contracts from "../contracts";
import { type DailyClose, fixedCostShare } from "../domain/close";

type BookScope = Scope<ExecutionContext>;

export class DailyCloseError extends LastroError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = "DailyCloseError";
  }
}

function monthOf(date: string) {
  const [year, month] = date.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month, 1));
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const last = textFromDate(new Date(next.getTime() - 86_400_000));
  return { start, next, previous, last };
}

export function createDailyClose(
  sales: Pick<SalesApi, "days">,
  finance: Pick<FinanceApi, "expenses">,
  clock: () => Date,
): { api: Record<string, never>; handlers: BoundOperation[] } {
  async function close(
    scope: BookScope,
    day: SalesDaySummary,
  ): Promise<DailyClose> {
    const date = textFromDate(day.businessDate);
    const month = monthOf(date);
    const monthDays = await sales.days.list(scope, {
      from: month.start,
      to: dateFromText(month.last),
    });
    const fixedOf = async (from: Date, to: Date) =>
      (
        await finance.expenses.totalByRole(scope, { from, to, role: "FIXED" })
      ).get(day.currency) ?? 0n;
    const fixed = fixedCostShare({
      monthFixed: await fixedOf(month.start, month.next),
      previousMonthFixed: await fixedOf(month.previous, month.start),
      openDays: monthDays.length,
      dayIndex: monthDays.findIndex(
        (each) => each.businessDate.getTime() === day.businessDate.getTime(),
      ),
      monthClosed: operationalDayClosed(month.last, clock()),
    });

    return {
      businessDate: date,
      currency: day.currency,
      sold: day.revenue,
      cost: day.cost,
      missingCost: day.missingCost,
      fixedShare: fixed.share,
      result: day.revenue - day.cost - fixed.share,
      provisional: fixed.provisional,
    };
  }

  return {
    api: {},
    handlers: [
      bind(contracts.getDailyClose, async ({ scope, input }) => {
        const date = dateFromText(input.businessDate);
        const [day] = await sales.days.list(scope, { from: date, to: date });
        if (!day)
          throw new DailyCloseError(
            "SALES_DAY_NOT_POSTED",
            `sales day ${input.businessDate} has no posted sale lines`,
            404,
          );
        return close(scope, day);
      }),
      bind(contracts.listDailyCloses, async ({ scope, input }) => {
        const days = await sales.days.list(scope, {
          from: dateFromText(input.from),
          to: dateFromText(input.to),
        });
        const items: DailyClose[] = [];
        for (const day of days) items.push(await close(scope, day));
        return { items };
      }),
    ],
  };
}
