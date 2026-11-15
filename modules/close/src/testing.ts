/** Core, finance, sales and close over memory, inside the real envelope. */
import type { FinanceApi } from "@lastro/finance";
import { financeTestHost } from "@lastro/finance/testing";
import { type ModuleDefinition, defineModule } from "@lastro/kernel";
import type { SalesApi, SalesPort } from "@lastro/sales";
import { memorySalesPort, salesTestModule } from "@lastro/sales/testing";
import { createClose } from ".";
import { closeOperations } from "./contracts";

export function closeTestHost(
  port: SalesPort = memorySalesPort(),
  clock: () => Date = () => new Date("2030-01-01T00:00:00Z"),
  extra: readonly ModuleDefinition<null>[] = [],
) {
  return financeTestHost([
    salesTestModule(port),
    defineModule<null, { finance: FinanceApi; sales: SalesApi }, unknown>({
      id: "close",
      dependsOn: ["core", "finance", "sales"],
      operations: closeOperations,
      create: ({ modules }) => createClose(modules, clock),
    }),
    ...extra,
  ]);
}
