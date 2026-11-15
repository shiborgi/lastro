/**
 * Sales' tables: the product catalog, the sales evidence a point of sale's
 * report is staged as (ADR 21), and the lines of each sales day.
 *
 * Products and sales are commercial evidence, not financial records (ADR 21):
 * a day's lines recognize no revenue; revenue comes from the payments report
 * (ADR 19). These tables reference core's, never the reverse (ADR 11).
 */
import { books } from "@lastro/core/db";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** The product tree, one level deep like the chart of accounts. */
export const productCategories = pgTable(
  "product_categories",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "product_categories_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("product_categories_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    bookForeignKey: foreignKey({
      name: "product_categories_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    parentForeignKey: foreignKey({
      name: "product_categories_book_id_parent_id_fk",
      columns: [table.bookId, table.parentId],
      foreignColumns: [table.bookId, table.id],
    }),
    selfParentCheck: check(
      "product_categories_self_parent_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
  }),
);

export const products = pgTable(
  "products",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    productCategoryId: integer("product_category_id").notNull(),
    /*
     * The unit cost the Book stands behind, in minor units, when the point of
     * sale's own cost is missing or wrong. Null uses the cost the day reports.
     */
    costOverride: bigint("cost_override", { mode: "bigint" }),
    active: boolean("active").default(true).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "products_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    keyUnique: uniqueIndex("products_book_id_key_uk").on(
      table.bookId,
      table.key,
    ),
    bookForeignKey: foreignKey({
      name: "products_book_id_books_id_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    productCategoryForeignKey: foreignKey({
      name: "products_book_id_product_category_id_fk",
      columns: [table.bookId, table.productCategoryId],
      foreignColumns: [productCategories.bookId, productCategories.id],
    }),
    costOverrideCheck: check(
      "products_cost_override_nonnegative",
      sql`${table.costOverride} is null or ${table.costOverride} >= 0`,
    ),
  }),
);

/* Which importer reads the Book's sales content of one type (ADR 21). */
export const saleConsumers = pgTable(
  "sale_consumers",
  {
    bookId: integer("book_id").notNull(),
    movementType: text("movement_type").notNull(),
    importerId: text("importer_id").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "sale_consumers_pk",
      columns: [table.bookId, table.movementType],
    }),
    bookForeignKey: foreignKey({
      name: "sale_consumers_book_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    typeCheck: check(
      "sale_consumers_type_check",
      sql`${table.movementType} ~ '^[a-z][a-z0-9-]{0,49}$'`,
    ),
  }),
);

/* The intake ledger of sales content: one row per content taken in. */
export const saleFiles = pgTable(
  "sale_files",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    movementType: text("movement_type").notNull(),
    importerId: text("importer_id").notNull(),
    importerVersion: integer("importer_version").notNull(),
    importerFingerprint: text("importer_fingerprint").notNull(),
    contentSha256: text("content_sha256").notNull(),
    sourceKey: text("source_key").notNull(),
    lineCount: integer("line_count").notNull(),
    newCount: integer("new_count").notNull(),
    importedBy: text("imported_by").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "sale_files_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    contentUnique: uniqueIndex("sale_files_content_uk").on(
      table.bookId,
      table.importerFingerprint,
      table.contentSha256,
    ),
    bookForeignKey: foreignKey({
      name: "sale_files_book_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    hashCheck: check(
      "sale_files_sha256_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$' and ${table.importerFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);

/* A point of sale's product code and the Book's product it always is (ADRs 16 and 21). */
export const saleMovementDescriptors = pgTable(
  "sale_movement_descriptors",
  {
    bookId: integer("book_id").notNull(),
    descriptorKey: text("descriptor_key").notNull(),
    /** The product as first printed. */
    name: text("name").notNull(),
    productId: integer("product_id"),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "sale_movement_descriptors_pk",
      columns: [table.bookId, table.descriptorKey],
    }),
    bookForeignKey: foreignKey({
      name: "sale_movement_descriptors_book_fk",
      columns: [table.bookId],
      foreignColumns: [books.id],
    }),
    productForeignKey: foreignKey({
      name: "sale_movement_descriptors_product_fk",
      columns: [table.bookId, table.productId],
      foreignColumns: [products.bookId, products.id],
    }),
  }),
);

/* One product's line of a day as the point of sale printed it (ADR 21). */
export const saleMovements = pgTable(
  "sale_movements",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    fileId: integer("file_id").notNull(),
    /** The sha256 of the line. */
    externalId: text("external_id").notNull(),
    businessDate: date("business_date", { mode: "date" }).notNull(),
    code: text("code"),
    name: text("name").notNull(),
    providerCategory: text("provider_category"),
    descriptorKey: text("descriptor_key").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    revenue: bigint("revenue", { mode: "bigint" }).notNull(),
    /** The line's total cost as the point of sale reported it. */
    cost: bigint("cost", { mode: "bigint" }),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("PENDING"),
    ignoreReason: text("ignore_reason"),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "sale_movements_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    externalUnique: uniqueIndex("sale_movements_external_uk").on(
      table.bookId,
      table.externalId,
    ),
    statusIdx: index("sale_movements_status_idx").on(
      table.bookId,
      table.status,
    ),
    fileForeignKey: foreignKey({
      name: "sale_movements_file_fk",
      columns: [table.bookId, table.fileId],
      foreignColumns: [saleFiles.bookId, saleFiles.id],
    }),
    descriptorForeignKey: foreignKey({
      name: "sale_movements_descriptor_fk",
      columns: [table.bookId, table.descriptorKey],
      foreignColumns: [
        saleMovementDescriptors.bookId,
        saleMovementDescriptors.descriptorKey,
      ],
    }),
    quantityCheck: check(
      "sale_movements_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
    revenueCheck: check(
      "sale_movements_revenue_nonnegative",
      sql`${table.revenue} >= 0`,
    ),
    costCheck: check(
      "sale_movements_cost_nonnegative",
      sql`${table.cost} is null or ${table.cost} >= 0`,
    ),
    currencyCheck: check(
      "sale_movements_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    /* POSTED is held against its line by a deferred trigger; IGNORED carries its reason. */
    statusCheck: check(
      "sale_movements_status_check",
      sql`${table.status} in ('PENDING', 'POSTED', 'IGNORED') and (${table.status} = 'IGNORED') = (${table.ignoreReason} is not null)`,
    ),
  }),
);

/** One product's line of a day, what a posted sale movement became (through its link). */
export const sales = pgTable(
  "sales",
  {
    id: serial("id").notNull(),
    bookId: integer("book_id").notNull(),
    businessDate: date("business_date", { mode: "date" }).notNull(),
    currency: text("currency").notNull(),
    productId: integer("product_id").notNull(),
    /** Quantities are not money: exact decimal, up to six places. */
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    revenue: bigint("revenue", { mode: "bigint" }).notNull(),
    unitCost: bigint("unit_cost", { mode: "bigint" }),
    cost: bigint("cost", { mode: "bigint" }),
    /* Where the cost came from: the day's report, the product's override, or nowhere. */
    costSource: text("cost_source")
      .$type<"SALE" | "CATALOG" | "MISSING">()
      .notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "sales_book_id_id_pk",
      columns: [table.bookId, table.id],
    }),
    dateIdx: index("sales_business_date_idx").on(
      table.bookId,
      table.businessDate,
    ),
    productForeignKey: foreignKey({
      name: "sales_book_id_product_id_fk",
      columns: [table.bookId, table.productId],
      foreignColumns: [products.bookId, products.id],
    }),
    revenueCheck: check(
      "sales_revenue_nonnegative",
      sql`${table.revenue} >= 0`,
    ),
    quantityCheck: check("sales_quantity_positive", sql`${table.quantity} > 0`),
    currencyCheck: check(
      "sales_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    costSourceCheck: check(
      "sales_cost_source_check",
      sql`${table.costSource} in ('SALE', 'CATALOG', 'MISSING')`,
    ),
    costMissingCheck: check(
      "sales_cost_missing_check",
      sql`(${table.costSource} = 'MISSING') = (${table.cost} is null)`,
    ),
  }),
);

/*
 * What a posted sale movement became (ADR 21): its one sale line. The link
 * carries the movement's external key and the line's own key, as every
 * movement link does (ADR 19).
 */
export const saleMovementLinks = pgTable(
  "sale_movement_links",
  {
    bookId: integer("book_id").notNull(),
    movementId: integer("movement_id").notNull(),
    /** The movement's external id: the hash of its line. */
    externalKey: text("external_key").notNull(),
    /** `<external key>-sale`: the line's own key. */
    saleKey: text("sale_key").notNull(),
    saleId: integer("sale_id").notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: "sale_movement_links_pk",
      columns: [table.bookId, table.movementId],
    }),
    saleUnique: uniqueIndex("sale_movement_links_sale_uk").on(
      table.bookId,
      table.saleId,
    ),
    saleKeyUnique: uniqueIndex("sale_movement_links_sale_key_uk").on(
      table.bookId,
      table.saleKey,
    ),
    externalKeyIdx: index("sale_movement_links_external_key_idx").on(
      table.bookId,
      table.externalKey,
    ),
    movementForeignKey: foreignKey({
      name: "sale_movement_links_movement_fk",
      columns: [table.bookId, table.movementId],
      foreignColumns: [saleMovements.bookId, saleMovements.id],
    }),
    saleForeignKey: foreignKey({
      name: "sale_movement_links_sale_fk",
      columns: [table.bookId, table.saleId],
      foreignColumns: [sales.bookId, sales.id],
    }),
  }),
);
