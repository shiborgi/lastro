import { expect, test } from "@playwright/test";

const books = {
  books: [
    { id: "1", name: "Personal" },
    { id: "2", name: "Business" },
  ],
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

function expensePage() {
  return {
    items: [
      {
        id: "e-1",
        bookId: "1",
        amountMinor: "2500",
        currency: "BRL",
      },
    ],
    nextCursor: null,
  };
}

function payments() {
  return {
    items: [
      {
        id: "p-1",
        bookId: "1",
        amountMinor: "2500",
        currency: "BRL",
      },
    ],
    nextCursor: null,
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/books", (route) => route.fulfill({ json: books }));
  await page.route("**/v1/books/*/position", (route) =>
    route.fulfill({ json: position() }),
  );
  await page.route("**/v1/books/*/expenses", (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({
        status: 201,
        json: {
          expense: {
            id: "e-new",
            bookId: "1",
            amountMinor: "1000",
            currency: "BRL",
          },
        },
      });
    } else {
      route.fulfill({ json: expensePage() });
    }
  });
  await page.route("**/v1/books/*/payments", (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({
        status: 201,
        json: {
          payment: {
            id: "p-new",
            bookId: "1",
            amountMinor: "1000",
            currency: "BRL",
          },
        },
      });
    } else {
      route.fulfill({ json: payments() });
    }
  });
  await page.route("**/v1/books/*/expense-settlements", (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({
        status: 201,
        json: {
          settlement: {
            id: "s-1",
            bookId: "1",
            expenseId: "e-1",
            paymentId: "p-1",
            amountMinor: "2500",
            currency: "BRL",
          },
        },
      });
    } else {
      route.fulfill({
        json: {
          items: [
            {
              id: "s-1",
              bookId: "1",
              expenseId: "e-1",
              paymentId: "p-1",
              amountMinor: "2500",
              currency: "BRL",
            },
          ],
          nextCursor: null,
        },
      });
    }
  });
  await page.route("**/v1/books/*/expense-settlements/*/void", (route) =>
    route.fulfill({
      json: {
        settlement: {
          id: "s-1",
          bookId: "1",
          voidedAt: "2026-01-01T00:00:00Z",
        },
      },
    }),
  );
});

test("creates an expense and payment and settles them through keyboard-operable forms", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New expense" }).click();
  await page.getByLabel("Account id").fill("a-1");
  await page.getByLabel("Party id").fill("pt-1");
  await page.getByLabel("Expense category id").fill("c-1");
  await page.getByLabel("Amount (minor units)").fill("1000");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Created expense e-new")).toBeVisible();

  await page.getByRole("button", { name: "New payment" }).click();
  await page.getByLabel("Account id").fill("a-1");
  await page.getByLabel("Amount (minor units)").fill("1000");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Created payment p-new")).toBeVisible();

  await page.getByRole("button", { name: "Settle" }).first().click();
  await page.getByLabel("Payment", { exact: true }).selectOption("p-1");
  await page
    .getByLabel("Settle expense e-1")
    .getByRole("button", { name: "Settle" })
    .click();
  await expect(page.getByText(/Settled expense/)).toBeVisible();
});

test("void confirmation names impact and cancels without change", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Void" }).first().click();
  const dialog = page.getByLabel("Void settlement");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/This will void settlement/)).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
});

test("surfaces concurrent balance conflict feedback without optimistic state", async ({
  page,
}) => {
  await page.route("**/v1/books/*/expense-settlements", (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({
        status: 409,
        json: {
          error: {
            code: "CONFLICT",
            message: "insufficient available balance",
          },
        },
      });
    } else {
      route.fulfill({
        json: {
          items: [
            {
              id: "s-1",
              bookId: "1",
              expenseId: "e-1",
              paymentId: "p-1",
              amountMinor: "2500",
              currency: "BRL",
            },
          ],
          nextCursor: null,
        },
      });
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settle" }).first().click();
  await page.getByLabel("Payment", { exact: true }).selectOption("p-1");
  await page
    .getByLabel("Settle expense e-1")
    .getByRole("button", { name: "Settle" })
    .click();
  await expect(page.getByText("insufficient available balance")).toBeVisible();
  await expect(page.getByText(/Settled expense/)).not.toBeVisible();
});
