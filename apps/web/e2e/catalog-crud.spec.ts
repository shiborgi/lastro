import { expect, test } from "@playwright/test";

/*
 * Drives the workspace against a mocked API so the flow can be asserted
 * without a database. The contract exercised here — proxy paths, verbs and
 * response shapes — is the same one apps/api serves.
 */

const BOOKS = { books: [{ id: "1", name: "Personal" }], user: { id: "u1" } };

const ACCOUNT = {
  id: "1",
  bookId: "1",
  key: "checking",
  name: "Checking",
  type: "CHECKING",
};

test.beforeEach(async ({ page }) => {
  const accounts: Record<string, unknown>[] = [ACCOUNT];

  await page.route("**/api/backend/v1/books", (route) =>
    route.fulfill({ json: BOOKS }),
  );
  await page.route("**/api/backend/v1/books/1/position*", (route) =>
    route.fulfill({
      json: { expenses: { items: [], nextCursor: null }, totals: [] },
    }),
  );
  await page.route("**/api/backend/v1/books/1/revenue-position*", (route) =>
    route.fulfill({
      json: { revenues: { items: [], nextCursor: null }, totals: [] },
    }),
  );
  await page.route("**/api/backend/v1/books/1/cash-flow", (route) =>
    route.fulfill({ json: { inflows: [], outflows: [], transfers: [] } }),
  );

  await page.route("**/api/backend/v1/books/1/accounts", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      accounts.push({ ...body, id: String(accounts.length + 1), bookId: "1" });
      return route.fulfill({ status: 201, json: accounts.at(-1) });
    }
    return route.fulfill({ json: { items: accounts } });
  });

  await page.route("**/api/backend/v1/books/1/accounts/*", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );

  await page.route("**/api/backend/**", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
});

test("creates an account through the Accounts tab", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Accounts" }).click();
  await expect(page.getByText("Checking")).toBeVisible();

  await page.getByRole("button", { name: "New account" }).click();
  await page.getByLabel("Key").fill("savings");
  await page.getByLabel("Name").fill("Savings");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Savings")).toBeVisible();
});

test("delete asks for confirmation before removing a record", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Accounts" }).click();

  await page.getByLabel("Delete Checking").click();
  await expect(page.getByText(/Delete "Checking"\?/)).toBeVisible();

  // Cancelling must leave the record in place.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Checking")).toBeVisible();
});

for (const width of [360, 768, 1280]) {
  test(`dialog fits a ${width}px viewport without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("tab", { name: "Accounts" }).click();
    await page.getByRole("button", { name: "New account" }).click();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflows).toBe(false);
  });
}
