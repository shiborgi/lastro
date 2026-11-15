/** Sales' PostgreSQL adapter, assembled from its parts. */
import type { SalesPort } from "../application/port";
import { createSalesCatalogRepository } from "./catalog";
import { createSalesDayRepository } from "./days";
import { createSaleEvidenceRepository } from "./movements";

export function createSalesRepository(): SalesPort {
  return {
    ...createSalesCatalogRepository(),
    ...createSalesDayRepository(),
    ...createSaleEvidenceRepository(),
  };
}
