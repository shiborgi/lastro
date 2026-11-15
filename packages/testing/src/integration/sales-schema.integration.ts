/// <reference types="bun-types" />
/* Sales' database rules, with plain inserts: they hold for any caller. */
import { afterAll, describe, expect, test } from "bun:test";
import { accounts, financialCategories, parties } from "@lastro/finance/db";
import {
  productCategories,
  products,
  saleFiles,
  saleMovementDescriptors,
  saleMovementLinks,
  saleMovements,
  sales,
} from "@lastro/sales/db";
import { and, eq } from "drizzle-orm";
import { expectPgError } from "../compose";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
afterAll(() => closeDb(db));

const REFUSED = "23514";
const day = (text: string) => new Date(`${text}T00:00:00Z`);

async function book() {
  const { book } = await seedBook(db, ["OWNER"]);
  const bookId = Number(book.id);
  const insert = async <T extends { id: number }>(rows: Promise<T[]>) =>
    ((await rows)[0] as T).id;
  return {
    bookId,
    account: (type: string) =>
      insert(
        db
          .insert(accounts)
          .values({ bookId, key: `acc-${type}`, name: type, type })
          .returning(),
      ),
    category: (kind: "EXPENSE" | "REVENUE", role: "DEDUCTION" | null = null) =>
      insert(
        db
          .insert(financialCategories)
          .values({ bookId, kind, name: `${kind}-${role}`, role })
          .returning(),
      ),
    party: () =>
      insert(
        db
          .insert(parties)
          .values({ bookId, key: "bar", name: "Bar", type: "COMPANY" })
          .returning(),
      ),
    productCategory: (key: string, parentId: number | null = null) =>
      insert(
        db
          .insert(productCategories)
          .values({ bookId, key, name: key, parentId })
          .returning(),
      ),
  };
}

describe("product categories", () => {
  test("nest one level", async () => {
    const b = await book();
    const drinks = await b.productCategory("drinks");
    const beer = await b.productCategory("beer", drinks);
    await expectPgError(b.productCategory("lager", beer), REFUSED);
    const food = await b.productCategory("food");
    await expectPgError(
      db
        .update(productCategories)
        .set({ parentId: food })
        .where(
          and(
            eq(productCategories.bookId, b.bookId),
            eq(productCategories.id, drinks),
          ),
        ),
      REFUSED,
    );
  });
});

describe("sale movements and lines (ADR 21)", () => {
  test("a link joins a movement to the line that says what it printed, and POSTED is exactly having it", async () => {
    const b = await book();
    const category = await b.productCategory("drinks");
    const [product] = await db
      .insert(products)
      .values({
        bookId: b.bookId,
        key: "beer",
        name: "Beer",
        productCategoryId: category,
      })
      .returning();
    const [file] = await db
      .insert(saleFiles)
      .values({
        bookId: b.bookId,
        movementType: "sale-movements",
        importerId: "yooga/sales",
        importerVersion: 1,
        importerFingerprint: "a".repeat(64),
        contentSha256: "b".repeat(64),
        sourceKey: "x",
        lineCount: 1,
        newCount: 1,
        importedBy: "test",
      })
      .returning();
    await db
      .insert(saleMovementDescriptors)
      .values({ bookId: b.bookId, descriptorKey: "10931990", name: "Beer" });
    const [movement] = await db
      .insert(saleMovements)
      .values({
        bookId: b.bookId,
        fileId: file?.id as number,
        externalId: "c".repeat(64),
        businessDate: day("2026-11-07"),
        name: "Beer",
        descriptorKey: "10931990",
        quantity: "3",
        revenue: 3000n,
        cost: 1200n,
        currency: "BRL",
      })
      .returning();
    const externalId = "c".repeat(64);
    const insertLine = (
      tx: Pick<typeof db, "insert">,
      values: Partial<typeof sales.$inferInsert> = {},
    ) =>
      tx
        .insert(sales)
        .values({
          bookId: b.bookId,
          businessDate: day("2026-11-07"),
          currency: "BRL",
          productId: product?.id as number,
          quantity: "3",
          revenue: 3000n,
          unitCost: 400n,
          cost: 1200n,
          costSource: "SALE",
          ...values,
        })
        .returning();
    const link = (
      tx: Pick<typeof db, "insert">,
      saleId: number,
      saleKey = `${externalId}-sale`,
    ) =>
      tx.insert(saleMovementLinks).values({
        bookId: b.bookId,
        movementId: movement?.id as number,
        externalKey: externalId,
        saleKey,
        saleId,
      });
    const post = (tx: Pick<typeof db, "update">) =>
      tx
        .update(saleMovements)
        .set({ status: "POSTED" })
        .where(
          and(
            eq(saleMovements.bookId, b.bookId),
            eq(saleMovements.id, movement?.id as number),
          ),
        );

    await expectPgError(insertLine(db, { costSource: "MISSING" }), REFUSED);
    // A line with no link is refused at commit.
    await expectPgError(
      db.transaction(async (tx) => {
        await insertLine(tx);
      }),
      REFUSED,
    );
    // A link to a line that says something else, or with another key.
    await expectPgError(
      db.transaction(async (tx) => {
        const [other] = await insertLine(tx, { revenue: 2999n });
        await link(tx, other?.id as number);
        await post(tx);
      }),
      REFUSED,
    );
    await expectPgError(
      db.transaction(async (tx) => {
        const [line] = await insertLine(tx);
        await link(tx, line?.id as number, "other-sale");
        await post(tx);
      }),
      REFUSED,
    );
    // A link without its movement POSTED is refused at commit.
    await expectPgError(
      db.transaction(async (tx) => {
        const [line] = await insertLine(tx);
        await link(tx, line?.id as number);
      }),
      REFUSED,
    );
    await db.transaction(async (tx) => {
      const [line] = await insertLine(tx);
      await link(tx, line?.id as number);
      await post(tx);
    });
    expect(
      await db
        .select()
        .from(saleMovementLinks)
        .where(eq(saleMovementLinks.bookId, b.bookId)),
    ).toHaveLength(1);
  });
});
