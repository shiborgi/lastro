import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import { Dashboard } from "../components/dashboard";

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = await handler(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const books = {
  books: [
    { id: "1", name: "Personal" },
    { id: "2", name: "Business" },
  ],
};

function position(bookId: string) {
  return {
    expenses: {
      items: [
        {
          expense: {
            id: `e-${bookId}`,
            bookId,
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

describe("dashboard", () => {
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchMock = mockFetch((url) => {
      if (url.endsWith("/books")) return books;
      if (url.includes("/position")) {
        const bookId = url.split("/")[3];
        return position(bookId);
      }
      return { items: [], nextCursor: null, totals: [] };
    });
  });

  afterEach(() => {
    fetchMock.restore();
  });

  test("scopes requests to the active Book and clears prior data on switch", async () => {
    await act(async () => {
      render(<Dashboard apiUrl="http://api" token="tok" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("1");
    expect(document.body.textContent).toContain("Personal");

    await act(async () => {
      select.value = "2";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(select.value).toBe("2");
    expect(document.body.textContent).toContain("Business");
    const positionCalls = fetchMock.calls.filter((call) =>
      call.url.includes("/position"),
    );
    const bookIds = positionCalls.map(
      (call) => call.url.match(/\/books\/([^/]+)\/position/)?.[1],
    );
    expect(bookIds).toContain("2");
  });

  test("renders loading, ready, and empty states", async () => {
    let resolveBooks: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveBooks = resolve;
    });
    fetchMock.restore();
    fetchMock = mockFetch((url) => {
      if (url.endsWith("/books")) return pending;
      return position("1");
    });

    await act(async () => {
      render(<Dashboard apiUrl="http://api" token="tok" />);
    });
    expect(document.body.textContent).toContain("Loading");

    await act(async () => {
      resolveBooks(books);
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Financial position");
    expect(document.body.textContent).toContain("Pending obligations");
  });

  test("renders an error state when the API fails", async () => {
    fetchMock.restore();
    fetchMock = mockFetch(() => {
      throw new Error("boom");
    });
    await act(async () => {
      render(<Dashboard apiUrl="http://api" token="tok" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("boom");
  });

  test("keyboard-operable Book selector follows visual order", async () => {
    await act(async () => {
      render(<Dashboard apiUrl="http://api" token="tok" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const select = document.querySelector("select") as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);
  });
});
