/**
 * The close module (ADR 11): views that combine sales and finance. Neither of
 * them knows the other; this module reads both through their interfaces and
 * stores nothing.
 */
import type { CoreApi } from "@lastro/core";
import type { FinanceApi } from "@lastro/finance";
import { defineModule } from "@lastro/kernel";
import type { SalesApi } from "@lastro/sales";
import { createDailyClose } from "./application/close";
import { closeOperations } from "./contracts";

type Dependencies = { core: CoreApi; finance: FinanceApi; sales: SalesApi };

export function createClose(
  modules: Pick<Dependencies, "finance" | "sales">,
  /* When "now" is, so a test can say whether a month has closed. */
  clock: () => Date = () => new Date(),
) {
  return createDailyClose(modules.sales, modules.finance, clock);
}

export const closeModule = defineModule<unknown, Dependencies, unknown>({
  id: "close",
  dependsOn: ["core", "finance", "sales"],
  operations: closeOperations,
  create: ({ modules }) => createClose(modules),
});

export { DailyCloseError } from "./application/close";
export * from "./domain/close";
