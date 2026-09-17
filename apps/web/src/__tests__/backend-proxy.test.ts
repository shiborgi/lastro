/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { safePath } from "@/app/api/backend/[...path]/route";

const BOOK = "01JB0000000000000000000000";
const RECORD = "01JB1111111111111111111111";

/*
 * The allowlist is a regex over strings, so TypeScript cannot tell when a new
 * screen calls a path the proxy refuses. That is how the review screen shipped
 * with a promote button that 404'd before the request ever left the web
 * container. Every entry below is a call that exists in `lib/api.ts`.
 */
describe("backend proxy allowlist", () => {
  test.each([
    ["v1/books", "listBooks"],
    [`v1/books/${BOOK}/insights`, "getInsights"],
    [`v1/books/${BOOK}/card-descriptors/pending`, "listPendingCardDescriptors"],
    [
      `v1/books/${BOOK}/account-descriptors/pending`,
      "listPendingAccountDescriptors",
    ],
    [`v1/books/${BOOK}/movements/card`, "listMovements (card)"],
    [`v1/books/${BOOK}/movements/account`, "listMovements (account)"],
    [`v1/books/${BOOK}/movements/card/${RECORD}/post`, "postMovement (card)"],
    [
      `v1/books/${BOOK}/movements/account/${RECORD}/post`,
      "postMovement (account)",
    ],
    [`v1/books/${BOOK}/card-descriptors`, "listCatalog"],
    [`v1/books/${BOOK}/account-reference-months`, "listCatalog (cycles)"],
    [
      `v1/books/${BOOK}/account-reference-months/${RECORD}`,
      "updateCatalog (cycles)",
    ],
    [`v1/books/${BOOK}/account-descriptors/${RECORD}`, "updateCatalog"],
    [`v1/books/${BOOK}/categories`, "createCatalog"],
    [`v1/books/${BOOK}/expenses`, "listFinancial"],
    [`v1/books/${BOOK}/position`, "getPosition"],
    [`v1/books/${BOOK}/revenue-position`, "getRevenuePosition"],
    [`v1/books/${BOOK}/payments/${RECORD}/void`, "voiding a payment"],
  ])("admits %s (%s)", (path) => {
    expect(safePath.test(path)).toBe(true);
  });

  test.each([
    [
      `v1/books/${BOOK}/audit-events`,
      "a resource the web app has no business reading",
    ],
    [
      `v1/books/${BOOK}/movements/card/${RECORD}`,
      "a movement read, which the API does not serve here",
    ],
    [
      `v1/books/${BOOK}/movements/wire/${RECORD}/post`,
      "a movement kind that does not exist",
    ],
    ["v1/agent-credentials", "a route outside Books entirely"],
    [
      `v1/books/${BOOK}/party-aliases`,
      "the table that was split in two and no longer exists",
    ],
    [`v1/books/${BOOK}/expenses/${RECORD}/../../../secrets`, "traversal"],
  ])("refuses %s (%s)", (path) => {
    expect(safePath.test(path)).toBe(false);
  });
});
