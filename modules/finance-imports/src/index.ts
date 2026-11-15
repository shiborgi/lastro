/** The finance-imports module: its manifest and public interface (ADRs 11 and 13). */
import type { CoreApi } from "@lastro/core";
import type { FinanceApi } from "@lastro/finance";
import { defineModule } from "@lastro/kernel";
import { asMovementImporter } from "./application/importer";
import {
  type FinanceImportsApi,
  createFinanceImports,
} from "./application/module";
import { financeImportsOperations } from "./contracts";
import { movementImporters } from "./parsers";

export const financeImportsModule = defineModule<
  unknown,
  { core: CoreApi; finance: FinanceApi },
  FinanceImportsApi
>({
  id: "finance-imports",
  dependsOn: ["core", "finance"],
  operations: financeImportsOperations,
  // The example parsers, then whatever the composed modules contribute.
  create: ({ modules, contributions }) =>
    createFinanceImports(
      [...movementImporters, ...contributions.map(asMovementImporter)],
      modules.finance,
    ),
});

export {
  type FinanceImportsApi,
  createFinanceImports,
} from "./application/module";
export {
  type MovementImporter,
  asMovementImporter,
} from "./application/importer";
export { readCsvTable } from "./parsers/read";
export { parseCsv, parseCsvRecords } from "./parsers/csv";
