/** The product catalog. */
export type ProductCategory = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  /** The group this sits inside, one level only. */
  parentId: string | null;
};

export type Product = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  productCategoryId: string;
  /** The unit cost the Book stands behind, in minor units; null uses the day's reported cost. */
  costOverride: bigint | null;
  active: boolean;
};
