/**
 * The daily close on the wire. Browser-safe. Derived on every read from
 * sales' days and finance's fixed expenses; nothing is stored.
 */
import {
  Amount,
  CalendarDate,
  Currency,
  Id,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";

export const DailyCloseResource = z
  .object({
    businessDate: CalendarDate,
    currency: Currency,
    sold: Amount,
    cost: Amount,
    missingCost: z.array(Id),
    fixedShare: z.string().regex(/^-?\d+$/),
    result: z.string().regex(/^-?\d+$/),
    provisional: z.boolean(),
  })
  .strict();
export type DailyCloseResource = z.infer<typeof DailyCloseResource>;

export const getDailyClose = defineOperation({
  id: "close.getDailyClose",
  access: "read",
  input: z.object({ businessDate: CalendarDate }).strict(),
  output: DailyCloseResource,
  http: { method: "GET", path: "/daily-closes/:businessDate" },
  mcp: {
    name: "get_daily_close",
    description:
      "The derived close of one posted day: sold, cost of goods, its share of the month's fixed costs and the result. Provisional while the month's fixed costs are not final. Never stored.",
  },
});

export const listDailyCloses = defineOperation({
  id: "close.listDailyCloses",
  access: "read",
  input: z.object({ from: CalendarDate, to: CalendarDate }).strict(),
  output: z.object({ items: z.array(DailyCloseResource) }).strict(),
  http: { method: "GET", path: "/daily-closes" },
  mcp: {
    name: "list_daily_closes",
    description:
      "The derived close of every posted day within [from, to], in date order.",
  },
});

export const closeOperations = [getDailyClose, listDailyCloses] as const;
