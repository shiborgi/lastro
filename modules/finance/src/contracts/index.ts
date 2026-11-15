import { accountMovementOperations } from "./account-movements";
/** Finance's wire schemas and operation descriptors. Browser-safe. */
import { cardOperations } from "./cards";
import { catalogOperations } from "./catalog";
import { expenseOperations } from "./expenses";
import { revenueMovementOperations } from "./revenue-movements";
import { revenueOperations } from "./revenues";

export * from "./cards";
export * from "./catalog";
export * from "./expenses";
export * from "./revenue-movements";
export * from "./revenues";
export * from "./account-movements";

export const financeOperations = [
  ...catalogOperations,
  ...expenseOperations,
  ...revenueOperations,
  ...accountMovementOperations,
  ...cardOperations,
  ...revenueMovementOperations,
] as const;
