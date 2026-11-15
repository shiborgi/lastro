/** Posted sales days on the wire. */
import {
  Amount,
  CalendarDate,
  Currency,
  Id,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";

export const CostSource = z.enum(["CATALOG", "SALE", "MISSING"]);

export const SaleLineResource = z
  .object({
    id: Id,
    productId: Id,
    quantity: z.string(),
    revenue: Amount,
    unitCost: Amount.nullable(),
    cost: Amount.nullable(),
    costSource: CostSource,
  })
  .strict();

export const SalesDayResource = z
  .object({
    businessDate: CalendarDate,
    currency: Currency,
    revenue: Amount,
    cost: Amount,
    /** Products whose line carries no cost; the day's result is incomplete until they do. */
    missingCost: z.array(Id),
    lines: z.array(SaleLineResource),
  })
  .strict();
export type SalesDayResource = z.infer<typeof SalesDayResource>;

export const getSalesDay = defineOperation({
  id: "sales.getSalesDay",
  access: "read",
  input: z.object({ businessDate: CalendarDate }).strict(),
  output: SalesDayResource,
  http: { method: "GET", path: "/sales-days/:businessDate" },
  mcp: {
    name: "get_sales_day",
    description:
      "One day with posted sale lines: its lines, totals and products missing a cost. Not found while none of its sale movements is posted.",
  },
});

export const listSalesDays = defineOperation({
  id: "sales.listSalesDays",
  access: "read",
  input: z
    .object({ from: CalendarDate.optional(), to: CalendarDate.optional() })
    .strict(),
  output: z
    .object({
      items: z.array(
        z
          .object({
            businessDate: CalendarDate,
            currency: Currency,
            revenue: Amount,
            cost: Amount,
            missingCost: z.number().int(),
          })
          .strict(),
      ),
    })
    .strict(),
  http: { method: "GET", path: "/sales-days" },
  mcp: {
    name: "list_sales_days",
    description:
      "List the days with posted sale lines in date order, optionally within [from, to].",
  },
});

export const dayOperations = [getSalesDay, listSalesDays] as const;
