import type { ResourceSpec } from "@/shell/resource-screen";
/** Sales' catalogs over the shell's resource screen. */
import { productCategories, products } from "@lastro/sales/contracts";

type Row = { id: string } & Record<string, unknown>;
const named = (row: Row) => String(row.name ?? row.key ?? row.id);

export const PRODUCT_CATEGORIES: ResourceSpec = {
  title: "Categorias de produto",
  singular: "categoria de produto",
  operations: productCategories,
  fields: [
    { name: "name", label: "Nome", required: true },
    { name: "key", label: "Chave", required: true, slugFrom: "name" },
    {
      name: "parentId",
      label: "Grupo",
      kind: "reference",
      reference: { list: productCategories.list, label: named },
      description:
        "Um nível só. Classifica o que o Book vende; não é categoria financeira.",
    },
  ],
};

export const PRODUCTS: ResourceSpec = {
  title: "Produtos",
  singular: "produto",
  operations: products,
  fields: [
    { name: "name", label: "Nome", required: true },
    { name: "key", label: "Chave", required: true, slugFrom: "name" },
    {
      name: "productCategoryId",
      label: "Categoria de produto",
      required: true,
      kind: "reference",
      reference: { list: productCategories.list, label: named },
    },
    {
      name: "costOverride",
      label: "Custo unitário",
      kind: "amount",
      description:
        "O custo que o Book assume. Vazio: usa o custo informado no dia.",
    },
    {
      name: "active",
      label: "Ativo",
      kind: "boolean",
      description: "Retire o produto em vez de excluí-lo depois de vendido.",
    },
  ],
};
