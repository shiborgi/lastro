/** The product catalog's use cases. */
import {
  type BoundOperation,
  type CrudStore,
  type ExecutionContext,
  type Scope,
  bindCrud,
} from "@lastro/kernel";
import * as contracts from "../contracts/catalog";
import type { Product, ProductCategory } from "../domain/catalog";
import type { SalesCatalogPort } from "./port";

const bookOf = (scope: Scope) => (scope.context as ExecutionContext).bookId;
type Input<T> = {
  [K in keyof Omit<T, "id" | "bookId">]?:
    | Omit<T, "id" | "bookId">[K]
    | undefined;
};

export function createSalesCatalog(port: SalesCatalogPort): {
  handlers: BoundOperation[];
} {
  const productCategories: CrudStore<
    ProductCategory,
    Input<ProductCategory>,
    Partial<ProductCategory>,
    Record<string, never>
  > = {
    list: (scope) => port.productCategories.list(scope.handle, bookOf(scope)),
    create: (scope, input) =>
      port.productCategories.insert(scope.handle, bookOf(scope), {
        key: input.key as string,
        name: input.name as string,
        parentId: input.parentId ?? null,
      }),
    update: (scope, id, patch) =>
      port.productCategories.update(scope.handle, bookOf(scope), id, patch),
    remove: (scope, id) =>
      port.productCategories.remove(scope.handle, bookOf(scope), id),
  };

  type ProductInput = Omit<Input<Product>, "costOverride"> & {
    costOverride?: string | null;
  };
  const toCost = (value: string | null | undefined) =>
    value === undefined ? undefined : value === null ? null : BigInt(value);
  const products: CrudStore<
    Product,
    ProductInput,
    ProductInput,
    { productCategoryId?: string; active?: boolean }
  > = {
    list: (scope, filter) =>
      port.products.list(scope.handle, bookOf(scope), filter),
    create: (scope, input) =>
      port.products.insert(scope.handle, bookOf(scope), {
        key: input.key as string,
        name: input.name as string,
        productCategoryId: input.productCategoryId as string,
        costOverride: toCost(input.costOverride) ?? null,
        active: input.active ?? true,
      }),
    update: (scope, id, patch) => {
      const { costOverride, ...rest } = patch;
      return port.products.update(scope.handle, bookOf(scope), id, {
        ...rest,
        ...(costOverride === undefined
          ? {}
          : { costOverride: toCost(costOverride) }),
      } as Partial<Product>);
    },
    remove: (scope, id) =>
      port.products.remove(scope.handle, bookOf(scope), id),
  };

  return {
    handlers: [
      ...bindCrud(
        contracts.productCategories,
        productCategories,
        "product_category",
      ),
      ...bindCrud(contracts.products, products, "product"),
    ],
  };
}
