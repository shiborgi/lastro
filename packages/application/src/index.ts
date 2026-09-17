import { createCatalogMethods } from "./catalog";
import { createExpenseMethods } from "./expenses";
import { createMovementMethods } from "./movements";
import { createRevenueMethods } from "./revenues";
import { createTransferMethods } from "./transfers";
import type { ApplicationRepository } from "./types";

export * from "./types";
export { databaseRefusal } from "./helpers";

export function createApplication(repository: ApplicationRepository) {
  const expenses = createExpenseMethods(repository);
  const revenues = createRevenueMethods(repository);
  const transfers = createTransferMethods(repository);
  return {
    ...createCatalogMethods(repository),
    ...expenses,
    ...revenues,
    ...transfers,
    ...createMovementMethods(repository, {
      createExpense: expenses.createExpense,
      createRevenue: revenues.createRevenue,
      createTransfer: transfers.createTransfer,
      createPayment: expenses.createPayment,
      createExpenseSettlement: expenses.createExpenseSettlement,
      createReceipt: revenues.createReceipt,
      createRevenueSettlement: revenues.createRevenueSettlement,
    }),
  };
}

export type Application = ReturnType<typeof createApplication>;
