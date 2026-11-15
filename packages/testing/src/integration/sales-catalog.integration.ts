/// <reference types="bun-types" />
/* The product catalog and sales settings through the composed host. */
import { afterAll, describe, expect, test } from "bun:test";
import { createHost } from "@lastro/host";
import { toFailure } from "@lastro/kernel";
import { closeDb, openTestDb } from "./database";
import { seedBook } from "./fixtures";

const db = openTestDb();
const host = createHost(db);
afterAll(() => closeDb(db));

type Row = { id: string } & Record<string, unknown>;

async function book() {
  const seeded = await seedBook(db, ["EDITOR"]);
  const run = (id: string, input: unknown) =>
    host.execute(id, seeded.as("EDITOR"), input);
  const row = async (id: string, input: unknown) =>
    (await run(id, input)) as Row;
  return { ...seeded, run, row };
}

const refusal = async (promise: Promise<unknown>) =>
  toFailure(
    await promise.then(
      () => null,
      (error: unknown) => error,
    ),
  );

describe("the product catalog on PostgreSQL", () => {
  test("products under a nested tree, cost in minor units, history kept by retiring", async () => {
    const { run, row } = await book();
    const drinks = await row("sales.createProductCategory", {
      key: "drinks",
      name: "Bebidas",
    });
    const beer = await row("sales.createProductCategory", {
      key: "beer",
      name: "Cervejas",
      parentId: drinks.id,
    });
    expect(
      await refusal(
        run("sales.createProductCategory", {
          key: "lager",
          name: "Lager",
          parentId: beer.id,
        }),
      ),
    ).toMatchObject({
      status: 409,
      message: expect.stringContaining("nest one level"),
    });

    const product = await row("sales.createProduct", {
      key: "heineken",
      name: "Heineken 600ml",
      productCategoryId: beer.id,
      costOverride: "780",
    });
    expect(product).toMatchObject({ costOverride: "780", active: true });
    expect(
      await refusal(run("sales.deleteProductCategory", { id: beer.id })),
    ).toMatchObject({
      status: 409,
      message: "the record is still referenced by another record",
    });
    expect(
      await run("sales.updateProduct", { id: product.id, active: false }),
    ).toMatchObject({ active: false });
    expect(await run("sales.listProducts", { active: false })).toMatchObject({
      items: [{ id: product.id }],
    });
  });
});
