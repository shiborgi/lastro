/** The sales-imports module: its manifest and public interface (ADRs 11 and 13). */
import type { CoreApi } from "@lastro/core";
import { defineModule } from "@lastro/kernel";
import type { SalesApi } from "@lastro/sales";
import { asSaleImporter } from "./application/importer";
import { type SalesImportsApi, createSalesImports } from "./application/module";
import { salesImportsOperations } from "./contracts";
import { saleImporters } from "./parsers";

export const salesImportsModule = defineModule<
  unknown,
  { core: CoreApi; sales: SalesApi },
  SalesImportsApi
>({
  id: "sales-imports",
  dependsOn: ["core", "sales"],
  operations: salesImportsOperations,
  // The example parsers, then whatever the composed modules contribute.
  create: ({ modules, contributions }) =>
    createSalesImports(
      [...saleImporters, ...contributions.map(asSaleImporter)],
      modules.sales,
    ),
});

export { type SalesImportsApi, createSalesImports } from "./application/module";
export { type SaleImporter, asSaleImporter } from "./application/importer";
export { parseCsvRecords } from "./parsers/csv";
