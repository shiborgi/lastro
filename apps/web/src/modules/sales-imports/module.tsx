/**
 * Sales imports' screens, as one web module (ADR 11): no view of its own,
 * an upload on the sales view its files fill.
 */
import { call } from "@/shell/client";
import { ImportFileDialog } from "@/shell/evidence-screen";
import type { WebModule } from "@/shell/registry";
import {
  importSales,
  salesImportsOperations,
} from "@lastro/sales-imports/contracts";

export const salesImportsWebModule: WebModule = {
  id: "sales-imports",
  label: "Importações de vendas",
  views: [],
  operations: salesImportsOperations,
  actions: {
    "sales-sale-movements": [
      {
        id: "import-sales",
        label: "Importar vendas",
        render: (context) => (
          <ImportFileDialog
            title="Importar vendas"
            description="O relatório de vendas do dia por produto, com data_inicio e data_fim. Enviar o mesmo arquivo de novo não duplica vendas."
            fileLabel="Arquivo de vendas"
            context={context}
            send={(file, key) =>
              call(
                importSales,
                {
                  type: "sale-movements",
                  key: file.name,
                  content: file.content,
                },
                { bookId: context.bookId, idempotencyKey: key },
              )
            }
          />
        ),
      },
    ],
  },
};
