/** Sales' screens, as one web module (ADR 11). */
import { call } from "@/shell/client";
import type { WebModule } from "@/shell/registry";
import { ResourceScreen, type ResourceSpec } from "@/shell/resource-screen";
import { listSaleMovements, salesOperations } from "@lastro/sales/contracts";
import { PRODUCTS, PRODUCT_CATEGORIES } from "./catalogs";
import { SaleMovementsScreen } from "./sale-movements";
import { SalesDaysScreen } from "./sales-days";

const catalog = (id: string, spec: ResourceSpec) => ({
  id,
  label: spec.title,
  group: "Cadastros",
  render: ({ bookId }: { bookId: string }) => (
    <ResourceScreen key={`${id}-${bookId}`} bookId={bookId} spec={spec} />
  ),
});

export const salesWebModule: WebModule = {
  id: "sales",
  label: "Vendas",
  operations: salesOperations,
  views: [
    {
      id: "sales-sale-movements",
      label: "Vendas importadas",
      group: "Importações",
      render: ({ bookId, actions }) => (
        <SaleMovementsScreen key={bookId} bookId={bookId} actions={actions} />
      ),
      count: async (bookId) =>
        (
          (await call(
            listSaleMovements,
            { status: "PENDING", limit: 100 },
            { bookId },
          )) as { items: unknown[] }
        ).items.length,
    },
    {
      id: "sales-sales-days",
      label: "Dias de venda",
      group: "Lançamentos",
      render: ({ bookId }) => <SalesDaysScreen key={bookId} bookId={bookId} />,
    },
    catalog("sales-products", PRODUCTS),
    catalog("sales-product-categories", PRODUCT_CATEGORIES),
  ],
};
