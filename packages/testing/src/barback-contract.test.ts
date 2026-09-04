/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const barbackYaml = readFileSync(resolve(repoRoot, "barback.yaml"), "utf8");

const readTools = [
  "list_books",
  "list_expenses",
  "list_payments",
  "list_expense_settlements",
  "get_book_position",
  "list_revenues",
  "list_receipts",
  "list_revenue_settlements",
  "get_revenue_position",
  "get_cash_flow",
];

const writeTools = [
  "create_expense",
  "create_payment",
  "settle_expense_with_payment",
  "create_revenue",
  "create_receipt",
  "settle_revenue_with_receipt",
  "create_transfer",
  "void_expense_settlement",
  "void_revenue_settlement",
];

describe("Barback deny-by-default integration contract", () => {
  test("registers Lastro as a deny-by-default server with a lastro. toolset", () => {
    expect(barbackYaml).toContain("id: lastro");
    expect(barbackYaml).toContain("default: deny");
    expect(barbackYaml).toContain("lastro:list_books");
    expect(barbackYaml).toContain("lastro:create_expense");
  });

  test("allowlists every exposed Lastro tool with the lastro. prefix", () => {
    for (const tool of [...readTools, ...writeTools]) {
      expect(barbackYaml).toContain(`lastro:${tool}`);
    }
  });

  test("classifies every tool as read or write in the gateway policy", () => {
    for (const tool of readTools) {
      expect(barbackYaml).toContain(`${tool}: { effect: read }`);
    }
    for (const tool of writeTools) {
      expect(barbackYaml).toContain(`${tool}: { effect: write }`);
    }
  });

  test("uses an environment-provided bearer credential, never a literal", () => {
    expect(barbackYaml).toContain("bearerToken: env:LASTRO_MCP_BEARER_TOKEN");
    expect(barbackYaml).not.toMatch(/LASTRO_MCP_BEARER_TOKEN\s*=\s*[^\s]+/);
  });
});
