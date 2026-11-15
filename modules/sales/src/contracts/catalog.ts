/** The product catalog on the wire. */
import {
  Amount,
  Id,
  defineCrudOperations,
  defineOperation,
} from "@lastro/kernel";
import { z } from "zod";

const DisplayName = z.string().trim().min(1).max(200);

export const ProductCategoryResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    name: DisplayName,
    parentId: Id.nullable(),
  })
  .strict();
export type ProductCategoryResource = z.infer<typeof ProductCategoryResource>;

const productCategoryFields = {
  key: Id,
  name: DisplayName,
  parentId: Id.nullable().optional(),
};

export const productCategories = defineCrudOperations({
  module: "sales",
  name: "ProductCategory",
  plural: "ProductCategories",
  path: "/product-categories",
  tool: "product_category",
  tools: "product_categories",
  resource: ProductCategoryResource,
  create: z.object(productCategoryFields).strict(),
  update: z.object(productCategoryFields).partial(),
  describe: {
    list: "List the product tree: categories of what the Book sells, nested one level. Not financial categories.",
    create:
      "Create a product category, optionally inside a group (`parentId`). Groups nest one level.",
    update: "Change a product category.",
    remove:
      "Delete a product category. Refused with CONFLICT while a product or child category references it.",
  },
});

export const ProductResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    name: DisplayName,
    productCategoryId: Id,
    costOverride: Amount.nullable(),
    active: z.boolean(),
  })
  .strict();
export type ProductResource = z.infer<typeof ProductResource>;

const productFields = {
  key: Id,
  name: DisplayName,
  productCategoryId: Id,
  costOverride: Amount.nullable().optional(),
  active: z.boolean().optional(),
};

export const products = defineCrudOperations({
  module: "sales",
  name: "Product",
  plural: "Products",
  path: "/products",
  tool: "product",
  tools: "products",
  resource: ProductResource,
  create: z.object(productFields).strict(),
  update: z.object(productFields).partial(),
  filter: z.object({
    productCategoryId: Id.optional(),
    // Query strings carry text: "false" must read as false, which z.coerce does not do.
    active: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .optional(),
  }),
  describe: {
    list: "List products, optionally of one product category or only active ones.",
    create:
      "Create a product the Book sells. `costOverride` is the unit cost in minor units the Book stands behind when the point of sale's cost is missing or wrong.",
    update:
      "Change a product; set `active: false` to retire it without losing its history.",
    remove:
      "Delete a product. Refused with CONFLICT once a posted day sold it; retire it instead.",
  },
});

export const catalogOperations = [
  ...Object.values(productCategories),
  ...Object.values(products),
];
