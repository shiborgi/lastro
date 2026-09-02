/// <reference types="bun" />
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
