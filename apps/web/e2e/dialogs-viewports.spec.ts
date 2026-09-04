import { expect, test } from "@playwright/test";

const books = {
  books: [{ id: "1", name: "Personal" }],
};

function position() {
  return {
    expenses: {
      items: [
        {
          expense: {
            id: "e-1",
            bookId: "1",
            amountMinor: "2500",
            currency: "BRL",
          },
          outstandingMinor: "2500",
          status: "OPEN",
        },
      ],
      nextCursor: null,
    },
    totals: [{ currency: "BRL", outstandingMinor: "2500", count: 1 }],
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/books", (route) => route.fulfill({ json: books }));
  await page.route("**/v1/books/*/position", (route) =>
    route.fulfill({ json: position() }),
  );
  await page.route("**/v1/books/*/expenses", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/v1/books/*/payments", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/v1/books/*/expense-settlements", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
});

for (const width of [360, 768, 1280]) {
  test(`expense dialog has no horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "New expense" }).click();
    await expect(page.getByLabel("New expense")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.scrollingElement?.scrollWidth ?? 0,
    );
    expect(overflow).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `e2e/__screenshots__/dialog-${width}.png`,
    });
  });
}
