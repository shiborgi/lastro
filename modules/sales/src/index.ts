/** The sales module: its manifest and public interface (ADR 11). */
import type { CoreApi } from "@lastro/core";
import { defineModule } from "@lastro/kernel";
import { type SalesApi, createSales } from "./application/module";
import { salesOperations } from "./contracts";
import { createSalesRepository } from "./db";

export const salesModule = defineModule<unknown, { core: CoreApi }, SalesApi>({
  id: "sales",
  dependsOn: ["core"],
  operations: salesOperations,
  create: () => createSales(createSalesRepository()),
});

export { type SalesApi, createSales } from "./application/module";
export type { SalesCatalogPort, SalesPort } from "./application/port";
export * from "./domain/catalog";
export * from "./domain/day";
export * from "./domain/movements";
export type { SalesDaySummary, SalesDaysApi } from "./application/days";
export type {
  SaleIntake,
  SaleIntakeResult,
  SaleMovementsApi,
} from "./application/movements";
