/** Sales' wire schemas and operation descriptors. Browser-safe. */
import { catalogOperations } from "./catalog";
import { dayOperations } from "./days";
import { movementOperations } from "./movements";

export * from "./catalog";
export * from "./days";
export * from "./movements";

export const salesOperations = [
  ...catalogOperations,
  ...dayOperations,
  ...movementOperations,
] as const;
