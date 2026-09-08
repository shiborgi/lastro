/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { createApi } from "./app";

describe("api health", () => {
  test("reports database down", async () => {
    const app = createApi({ ping: async () => false });
    const response = await app.request("/health");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.database.status).toBe("down");
  });

  test("reports database up", async () => {
    const app = createApi({ ping: async () => true });
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.database.status).toBe("up");
  });
});

describe("v1 API boundary", () => {
  test("uses a structured authentication error for Book-scoped routes", async () => {
    const app = createApi({ ping: async () => true });
    const response = await app.request("/v1/books/1/expenses");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "authentication is required" },
    });
  });
});
