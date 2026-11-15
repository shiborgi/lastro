/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { UnauthorizedError } from "@lastro/kernel";
import { salesTestHost } from "../testing";

type Row = { id: string } & Record<string, unknown>;

function sales() {
  const { host, memory, as } = salesTestHost();
  const run = (id: string, input: unknown) =>
    host.execute(id, as("editor"), input);
  const row = async (id: string, input: unknown) =>
    (await run(id, input)) as Row;
  return { run, row, memory };
}

describe("the product catalog", () => {
  test("products carry their cost override as minor units and filter by category and activity", async () => {
    const { run, row } = sales();
    const drinks = await row("sales.createProductCategory", {
      key: "drinks",
      name: "Bebidas",
    });
    expect(drinks).toEqual({
      id: "1",
      bookId: "1",
      key: "drinks",
      name: "Bebidas",
      parentId: null,
    });
    const beer = await row("sales.createProduct", {
      key: "beer",
      name: "Cerveja",
      productCategoryId: drinks.id,
      costOverride: "450",
    });
    expect(beer).toMatchObject({ costOverride: "450", active: true });
    await run("sales.updateProduct", { id: beer.id, active: false });
    expect(await run("sales.listProducts", { active: true })).toEqual({
      items: [],
    });
    expect(
      await run("sales.listProducts", { productCategoryId: drinks.id }),
    ).toMatchObject({
      items: [{ id: beer.id, active: false, costOverride: "450" }],
    });
    expect(
      await run("sales.updateProduct", { id: beer.id, costOverride: null }),
    ).toMatchObject({
      costOverride: null,
    });
    await expect(run("sales.deleteProduct", { id: "99" })).rejects.toThrow(
      UnauthorizedError,
    );
  });
});
