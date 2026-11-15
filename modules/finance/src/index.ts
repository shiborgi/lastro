/** The finance module: its manifest and public interface (ADR 11). */
import type { CoreApi } from "@lastro/core";
import { defineModule } from "@lastro/kernel";
import { type FinanceApi, createFinance } from "./application/module";
import { financeOperations } from "./contracts";
import { createFinanceRepository } from "./db";

export const financeModule = defineModule<
  unknown,
  { core: CoreApi },
  FinanceApi
>({
  id: "finance",
  dependsOn: ["core"],
  operations: financeOperations,
  // Stateless: every query runs on the handle of the scope it is called in.
  create: () => createFinance(createFinanceRepository()),
});

export type { CatalogApi } from "./application/catalog";
export type { ExpensesApi } from "./application/expenses";
export { type FinanceApi, createFinance } from "./application/module";
export type {
  CatalogPort,
  CatalogTable,
  FinancePort,
} from "./application/port";
export * from "./domain/catalog";
export * from "./domain/account-movements";
export * from "./domain/cards";
export * from "./domain/revenue-movements";
export type {
  RevenueMovementIntake,
  RevenueMovementsApi,
} from "./application/revenue-movements";
export type { CardIntake, CardsApi } from "./application/cards";
export type {
  MovementIntake,
  MovementIntakeResult,
  AccountMovementsApi,
} from "./application/account-movements";
