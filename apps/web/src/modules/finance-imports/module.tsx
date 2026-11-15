/**
 * Statement imports' screens, as one web module (ADR 11): no view of its
 * own, an upload on each finance view its files fill.
 */
import type { WebModule } from "@/shell/registry";
import { financeImportsOperations } from "@lastro/finance-imports/contracts";
import { importInvoice, importRevenues, importStatement } from "./imports";

export const financeImportsWebModule: WebModule = {
  id: "finance-imports",
  label: "Importações",
  views: [],
  operations: financeImportsOperations,
  actions: {
    "finance-account-movements": [
      {
        id: "import-statement",
        label: "Importar extrato",
        render: importStatement,
      },
    ],
    "finance-card-movements": [
      { id: "import-invoice", label: "Importar fatura", render: importInvoice },
    ],
    "finance-revenue-movements": [
      {
        id: "import-revenues",
        label: "Importar receitas",
        render: importRevenues,
      },
    ],
  },
};
