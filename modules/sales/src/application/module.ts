/** Sales' use cases over its port, and the handlers of its operations. */
import type { BoundOperation } from "@lastro/kernel";
import { createSalesCatalog } from "./catalog";
import { type SalesDaysApi, createSalesDays } from "./days";
import { type SaleMovementsApi, createSaleMovements } from "./movements";
import type { SalesPort } from "./port";

export type SalesApi = {
  /** Sales evidence, for the sales-imports module (ADR 21). */
  movements: SaleMovementsApi;
  /** Posted days' totals, for modules that report on them. */
  days: SalesDaysApi;
};

export function createSales(port: SalesPort): {
  api: SalesApi;
  handlers: readonly BoundOperation[];
} {
  const catalog = createSalesCatalog(port);
  const days = createSalesDays(port);
  const movements = createSaleMovements(port);
  return {
    api: { movements: movements.api, days: days.api },
    handlers: [...catalog.handlers, ...days.handlers, ...movements.handlers],
  };
}
