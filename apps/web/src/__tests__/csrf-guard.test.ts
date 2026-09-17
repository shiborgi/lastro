/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { isSameSite } from "@/app/api/backend/[...path]/route";

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://internal-container:3000/api/backend/v1/books", {
    method: "POST",
    headers,
  });
}

describe("proxy CSRF guard", () => {
  test("accepts a browser write from the host it was served on", () => {
    expect(
      isSameSite(
        requestWith({
          origin: "http://localhost:3000",
          host: "localhost:3000",
        }),
      ),
    ).toBe(true);
  });

  test("rejects a write whose Origin is a different site", () => {
    expect(
      isSameSite(
        requestWith({
          origin: "https://attacker.example",
          host: "lastro.example",
        }),
      ),
    ).toBe(false);
  });

  /*
   * The regression this guard actually shipped with: comparing full origins
   * against the server's own URL meant every deployment behind a port mapping
   * or a TLS-terminating proxy rejected all writes with 403.
   */
  test("accepts a write behind TLS termination, where the proxy speaks https and the app speaks http", () => {
    expect(
      isSameSite(
        requestWith({
          origin: "https://box.example.ts.net",
          host: "box.example.ts.net",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(true);
  });

  test("accepts a write when the proxy forwards a host carrying a port", () => {
    expect(
      isSameSite(
        requestWith({
          origin: "https://box.example.ts.net",
          "x-forwarded-host": "box.example.ts.net:9998",
          host: "127.0.0.1:3010",
        }),
      ),
    ).toBe(true);
  });

  test("accepts a published container port, where the app listens on another", () => {
    expect(
      isSameSite(
        requestWith({
          origin: "http://127.0.0.1:3010",
          host: "127.0.0.1:3010",
        }),
      ),
    ).toBe(true);
  });

  test("allows a non-browser caller, which sends no Origin", () => {
    expect(isSameSite(requestWith({ host: "lastro.example" }))).toBe(true);
  });

  test("rejects when no host is available to compare against", () => {
    const request = new Request("http://internal/api", { method: "POST" });
    request.headers.set("origin", "https://lastro.example");
    request.headers.delete("host");
    expect(isSameSite(request)).toBe(false);
  });

  test("rejects a lookalike hostname that merely shares a suffix", () => {
    expect(
      isSameSite(
        requestWith({
          origin: "https://evil-lastro.example",
          host: "lastro.example",
        }),
      ),
    ).toBe(false);
  });
});
