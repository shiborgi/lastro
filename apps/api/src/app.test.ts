/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { closeTestHost } from "@lastro/close/testing";
import type { CoreApi } from "@lastro/core";
import type { LastroHost } from "@lastro/host";
import { createHttp, routeOf } from "./app";

/* The real modules over memory: the adapter is exercised against every real descriptor. */
function api(sessionUserId: string | null = "editor") {
  const { host } = closeTestHost();
  const app = createHttp({
    host: host as unknown as LastroHost,
    ping: async () => true,
    sessionUser: async () => sessionUserId,
  });
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, host, call };
}

describe("the HTTP adapter", () => {
  test("publishes every operation of the host at its route", async () => {
    const { host, call } = api();
    expect(host.operations.length).toBeGreaterThan(40);
    for (const descriptor of host.operations) {
      const path = routeOf(descriptor)
        .replace(":bookId", "1")
        .replace(/:[A-Za-z]+/g, "1");
      const response = await call(
        descriptor.http.method,
        path,
        descriptor.http.method === "GET" ? undefined : {},
      );
      const body = (await response.json()) as { error?: { code: string } };
      expect(`${descriptor.id} ${body.error?.code ?? "ok"}`).not.toBe(
        `${descriptor.id} NOT_FOUND`,
      );
    }
  });

  test("a Book operation reads the body and path, and answers with the wire result", async () => {
    const { call } = api();
    const created = await call("POST", "/v1/books/1/accounts", {
      key: "bank",
      name: "Bank",
      type: "ACCOUNT",
    });
    expect(created.status).toBe(200);
    const account = (await created.json()) as { id: string };
    const updated = await call("PATCH", `/v1/books/1/accounts/${account.id}`, {
      name: "Main Bank",
    });
    expect(await updated.json()).toMatchObject({
      id: account.id,
      name: "Main Bank",
      type: "ACCOUNT",
    });
    const listed = await call("GET", "/v1/books/1/accounts");
    expect(await listed.json()).toMatchObject({
      items: [{ name: "Main Bank" }],
    });
  });

  test("a GET takes its input from the query string", async () => {
    const { call } = api();
    const drinks = (await (
      await call("POST", "/v1/books/1/product-categories", {
        key: "drinks",
        name: "Bebidas",
      })
    ).json()) as { id: string };
    await call("POST", "/v1/books/1/products", {
      key: "beer",
      name: "Beer",
      productCategoryId: drinks.id,
      active: false,
    });
    expect(
      await (await call("GET", "/v1/books/1/products?active=false")).json(),
    ).toMatchObject({
      items: [{ key: "beer" }],
    });
    expect(
      await (await call("GET", "/v1/books/1/products?active=true")).json(),
    ).toEqual({ items: [] });
  });

  test("the idempotency key travels in its header", async () => {
    const { call } = api();
    const body = { key: "bank", name: "Bank" };
    const headers = { "idempotency-key": "k1" };
    const first = await (
      await call("POST", "/v1/books/1/institutions", body, headers)
    ).json();
    const again = await (
      await call("POST", "/v1/books/1/institutions", body, headers)
    ).json();
    expect(again).toEqual(first);
    expect(
      await (await call("GET", "/v1/books/1/institutions")).json(),
    ).toEqual({ items: [first] });
  });

  test("failures carry the mapped status and code", async () => {
    const { call } = api();
    const invalid = await call("POST", "/v1/books/1/accounts", {
      key: "x",
      name: "X",
      type: "ACQUIRER",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });

    const stranger = await call("GET", "/v1/books/2/accounts");
    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toMatchObject({
      error: { code: "UNAUTHORIZED_OR_NOT_FOUND" },
    });

    const viewer = api("viewer");
    const forbidden = await viewer.call("POST", "/v1/books/1/institutions", {
      key: "a",
      name: "A",
    });
    expect(forbidden.status).toBe(403);
  });

  test("no session and no credential is 401; a user operation needs no Book", async () => {
    const anonymous = api(null);
    expect((await anonymous.call("GET", "/v1/books/1/accounts")).status).toBe(
      401,
    );
    const { call, host } = api();
    const core = (host.modules as { core: CoreApi }).core;
    const book = await core.admin.ensureBook({ key: "bar", name: "Bar" });
    await core.admin.setBookMember({
      bookId: book.id,
      userId: "editor",
      role: "EDITOR",
    });
    expect(await (await call("GET", "/v1/books")).json()).toMatchObject({
      items: [{ key: "bar" }],
    });
  });

  test("liveness answers without the database", async () => {
    const app = createHttp({
      host: closeTestHost().host as unknown as LastroHost,
      ping: async () => {
        throw new Error("database down");
      },
      sessionUser: async () => null,
    });
    expect(await (await app.request("/health/live")).json()).toEqual({
      status: "live",
    });
    expect((await app.request("/health")).status).toBe(503);
  });

  test("health reports the database", async () => {
    const { call } = api();
    expect(await (await call("GET", "/health")).json()).toEqual({
      status: "ok",
      database: { status: "up" },
    });
  });
});
