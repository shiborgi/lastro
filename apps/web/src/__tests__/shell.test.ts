/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { webModules } from "@/modules";
import { createAllowlist } from "@/shell/allowlist";
import { ApiError, call, requestOf } from "@/shell/client";
import { createRegistry } from "@/shell/registry";
import { financeImportsOperations } from "@lastro/finance-imports/contracts";
import { financeOperations } from "@lastro/finance/contracts";

const webOperations = createRegistry(webModules).operations;
const isAllowed = createAllowlist(webOperations);

const byId = (id: string) => {
  const found = webOperations.find((each) => each.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("the proxy allowlist", () => {
  test("lets through every published operation at its own method, and nothing else", () => {
    for (const descriptor of webOperations) {
      const { path } = requestOf(
        descriptor,
        Object.fromEntries(
          (descriptor.http.path.match(/:[A-Za-z]+/g) ?? []).map((param) => [
            param.slice(1),
            "2026-11-07",
          ]),
        ),
        "1",
      );
      expect({
        id: descriptor.id,
        allowed: isAllowed(descriptor.http.method, path),
      }).toEqual({
        id: descriptor.id,
        allowed: true,
      });
    }
    expect(isAllowed("DELETE", "v1/books/1/accounts")).toBe(false);
    expect(isAllowed("GET", "v1/books/1/secrets")).toBe(false);
    expect(isAllowed("GET", "v1/books/1/../admin")).toBe(false);
    expect(isAllowed("GET", "v1/books")).toBe(true);
  });

  test("forwards only the operations of the modules registered", () => {
    const withoutImports = createAllowlist(
      createRegistry(webModules.filter((each) => !each.id.endsWith("-imports")))
        .operations,
    );
    expect(withoutImports("GET", "v1/books/1/accounts")).toBe(true);
    expect(withoutImports("POST", "v1/books/1/movement-imports")).toBe(false);
    expect(
      financeImportsOperations.some(
        (each) => each.http.path === "/movement-imports",
      ),
    ).toBe(true);
  });
});

describe("the client", () => {
  test("puts path parameters in the path, a GET's input in the query, a write's in the body", () => {
    expect(
      requestOf(byId("finance.updateAccount"), { id: "7", name: "Bank" }, "1"),
    ).toEqual({
      path: "v1/books/1/accounts/7",
      query: new URLSearchParams(),
      body: { name: "Bank" },
    });
    const listed = requestOf(
      byId("finance.listExpenses"),
      { limit: 10, referenceMonth: "2026-11-01" },
      "1",
    );
    expect(listed.path).toBe("v1/books/1/expenses");
    expect(listed.query.toString()).toBe("limit=10&referenceMonth=2026-11-01");
    expect(listed.body).toBeUndefined();
    expect(() => requestOf(byId("finance.listAccounts"), {})).toThrow(
      "needs a bookId",
    );
  });

  test("validates the answer with the operation's output, and raises the API's error", async () => {
    const [list] = financeOperations;
    const answer = (status: number, body: unknown) =>
      (async () =>
        new Response(JSON.stringify(body), {
          status,
        })) as unknown as typeof fetch;
    expect(
      await call(
        list as (typeof financeOperations)[number],
        {},
        { bookId: "1", fetch: answer(200, { items: [] }) },
      ),
    ).toEqual({ items: [] });
    await expect(
      call(
        list as (typeof financeOperations)[number],
        {},
        { bookId: "1", fetch: answer(200, { rows: [] }) },
      ),
    ).rejects.toThrow();
    const refused = call(
      byId("finance.createAccount"),
      { key: "x", name: "X", type: "CASH" },
      {
        bookId: "1",
        fetch: answer(409, { error: { code: "CONFLICT", message: "taken" } }),
      },
    );
    await expect(refused).rejects.toBeInstanceOf(ApiError);
    await expect(refused).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "taken",
    });
  });

  test("sends the idempotency key in its header", async () => {
    let headers: Record<string, string> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({ id: "1", bookId: "1", key: "bank", name: "Bank" }),
      );
    }) as unknown as typeof fetch;
    await call(
      byId("finance.createInstitution"),
      { key: "bank", name: "Bank" },
      {
        bookId: "1",
        idempotencyKey: "k1",
        fetch: capture,
      },
    );
    expect(headers["idempotency-key"]).toBe("k1");
  });
});

describe("the module registry", () => {
  test("refuses a duplicate module or view", () => {
    const view = { id: "a", label: "A", render: () => null };
    const operations = [] as const;
    expect(() =>
      createRegistry([
        { id: "m", label: "M", views: [view], operations },
        { id: "m", label: "N", views: [], operations },
      ]),
    ).toThrow("duplicate web module");
    expect(() =>
      createRegistry([
        { id: "m", label: "M", views: [view, view], operations },
      ]),
    ).toThrow("duplicate web view");
    expect(
      createRegistry([{ id: "m", label: "M", views: [view], operations }])
        .first,
    ).toBe("a");
  });

  test("hands each view the actions other modules add, and refuses one on a missing view", () => {
    const view = { id: "a", label: "A", render: () => null };
    const action = { id: "upload", label: "Upload", render: () => null };
    const registry = createRegistry([
      { id: "m", label: "M", views: [view], operations: [] },
      {
        id: "n",
        label: "N",
        views: [],
        operations: [],
        actions: { a: [action] },
      },
    ]);
    expect(registry.actionsOf("a")).toEqual([action]);
    expect(registry.modules.map((each) => each.id)).toEqual(["m"]);
    expect(() =>
      createRegistry([
        {
          id: "n",
          label: "N",
          views: [],
          operations: [],
          actions: { a: [action] },
        },
      ]),
    ).toThrow("web module n adds actions to a, which no registered module has");
  });
});
