/** Finance's PostgreSQL adapter, assembled from its parts. */
import type { FinancePort } from "../application/port";
import { createAccountMovementRepository } from "./account-movements";
import { createCardRepository } from "./cards";
import { createCatalogRepository } from "./catalog";
import { createExpenseRepository } from "./expenses";
import { createRevenueMovementRepository } from "./revenue-movements";
import { createRevenueRepository } from "./revenues";

export function createFinanceRepository(): FinancePort {
  return {
    ...createCatalogRepository(),
    ...createExpenseRepository(),
    ...createRevenueRepository(),
    ...createAccountMovementRepository(),
    ...createCardRepository(),
    ...createRevenueMovementRepository(),
  };
}
