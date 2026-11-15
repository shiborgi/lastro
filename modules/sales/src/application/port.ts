/**
 * Sales' own persistence port. Every method takes the scope's `handle`
 * first, so it runs on the caller's transaction.
 */
import type { CatalogTable } from "@lastro/kernel";
import type { Product, ProductCategory } from "../domain/catalog";
import type { SaleLine, SalesDay } from "../domain/day";
import type {
  SaleConsumer,
  SaleFile,
  SaleMovement,
  SaleMovementDescriptor,
  SaleMovementLink,
  SaleMovementStatus,
} from "../domain/movements";

type PageQuery = { after?: string; limit: number };

export type SalesCatalogPort = {
  productCategories: CatalogTable<ProductCategory>;
  products: CatalogTable<
    Product,
    { productCategoryId?: string; active?: boolean }
  >;
};

export type SalesDayPort = {
  lines: {
    insert(
      handle: unknown,
      bookId: string,
      line: Omit<SaleLine, "id" | "bookId">,
    ): Promise<SaleLine>;
    remove(handle: unknown, bookId: string, id: string): Promise<void>;
    /** One day's lines, or every day's within the range when no date is given. */
    list(
      handle: unknown,
      bookId: string,
      query: { businessDate?: Date; from?: Date; to?: Date },
    ): Promise<SaleLine[]>;
    /** The days with posted lines, in date order. */
    days(
      handle: unknown,
      bookId: string,
      range: { from?: Date; to?: Date },
    ): Promise<SalesDay[]>;
  };
};

/** Sales evidence (ADR 21). */
export type SaleEvidencePort = {
  saleConsumers: {
    get(
      handle: unknown,
      bookId: string,
      movementType: string,
    ): Promise<SaleConsumer | null>;
    set(
      handle: unknown,
      bookId: string,
      input: Omit<SaleConsumer, "bookId" | "setAt">,
    ): Promise<SaleConsumer>;
    list(handle: unknown, bookId: string): Promise<SaleConsumer[]>;
  };
  saleFiles: {
    findByContent(
      handle: unknown,
      bookId: string,
      query: { importerFingerprint: string; contentSha256: string },
    ): Promise<SaleFile | null>;
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<SaleFile, "id" | "bookId" | "importedAt">,
    ): Promise<SaleFile>;
    /** Newest first. */
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery,
    ): Promise<SaleFile[]>;
  };
  saleMovementDescriptors: {
    /** The descriptor of a key, created empty when new. */
    ensure(
      handle: unknown,
      bookId: string,
      input: { descriptorKey: string; name: string },
    ): Promise<SaleMovementDescriptor>;
    get(
      handle: unknown,
      bookId: string,
      descriptorKey: string,
    ): Promise<SaleMovementDescriptor | null>;
    list(
      handle: unknown,
      bookId: string,
      query: { classified?: boolean },
    ): Promise<SaleMovementDescriptor[]>;
    classify(
      handle: unknown,
      bookId: string,
      descriptorKey: string,
      productId: string,
    ): Promise<SaleMovementDescriptor>;
  };
  saleMovements: {
    findByExternalIds(
      handle: unknown,
      bookId: string,
      externalIds: readonly string[],
    ): Promise<SaleMovement[]>;
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<SaleMovement, "id" | "bookId" | "status" | "ignoreReason">,
    ): Promise<SaleMovement>;
    get(
      handle: unknown,
      bookId: string,
      id: string,
    ): Promise<SaleMovement | null>;
    /** Newest id first. */
    list(
      handle: unknown,
      bookId: string,
      query: PageQuery & {
        status?: SaleMovementStatus;
        descriptorKey?: string;
        businessDate?: Date;
      },
    ): Promise<SaleMovement[]>;
    update(
      handle: unknown,
      bookId: string,
      id: string,
      patch: Partial<Pick<SaleMovement, "status" | "ignoreReason">>,
    ): Promise<SaleMovement>;
    /** Serialize writers of one movement until this transaction ends. */
    lock(handle: unknown, bookId: string, id: string): Promise<void>;
  };
  saleLinks: {
    insert(
      handle: unknown,
      bookId: string,
      input: Omit<SaleMovementLink, "bookId">,
    ): Promise<SaleMovementLink>;
    list(
      handle: unknown,
      bookId: string,
      query: {
        movementId?: string;
        externalKey?: string;
        saleKey?: string;
        saleId?: string;
      },
    ): Promise<SaleMovementLink[]>;
    removeOfMovement(
      handle: unknown,
      bookId: string,
      movementId: string,
    ): Promise<void>;
  };
};

export type SalesPort = SalesCatalogPort & SalesDayPort & SaleEvidencePort;
